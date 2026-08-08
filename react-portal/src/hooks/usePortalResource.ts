import { useEffect, useRef, useState } from 'react'

interface CacheEntry<T> {
  value?: T
  error?: Error
  updatedAt: number
  promise?: Promise<T>
  listeners: Set<() => void>
}

const cache = new Map<string, CacheEntry<unknown>>()

function entryFor<T>(key: string): CacheEntry<T> {
  let entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) {
    entry = { updatedAt: 0, listeners: new Set() }
    cache.set(key, entry as CacheEntry<unknown>)
  }
  return entry
}

function notify(entry: CacheEntry<unknown>): void {
  entry.listeners.forEach(listener => listener())
}

async function load<T>(key: string, fetcher: () => Promise<T>, force = false, ttlMs = 10_000): Promise<T> {
  const entry = entryFor<T>(key)
  const fresh = entry.value !== undefined && Date.now() - entry.updatedAt < ttlMs
  if (!force && fresh) return entry.value as T
  if (entry.promise) return entry.promise

  const promise = fetcher()
    .then(value => {
      entry.value = value
      entry.error = undefined
      entry.updatedAt = Date.now()
      return value
    })
    .catch(error => {
      entry.error = error instanceof Error ? error : new Error(String(error))
      throw error
    })
    .finally(() => {
      entry.promise = undefined
      notify(entry as CacheEntry<unknown>)
    })
  entry.promise = promise
  notify(entry as CacheEntry<unknown>)
  return promise
}

export function invalidatePortalResource(key: string): void {
  const entry = cache.get(key)
  if (!entry) return
  entry.updatedAt = 0
  notify(entry)
}

export function clearPortalResourceCache(): void {
  cache.clear()
}

export function usePortalResource<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { ttlMs?: number; refreshMs?: number; enabled?: boolean } = {},
) {
  const ttlMs = options.ttlMs ?? 10_000
  const refreshMs = options.refreshMs ?? 0
  const enabled = options.enabled ?? true
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const [, rerender] = useState(0)
  const entry = entryFor<T>(key)

  useEffect(() => {
    if (!enabled) return
    const current = entryFor<T>(key)
    const listener = () => rerender(value => value + 1)
    current.listeners.add(listener)
    void load(key, () => fetcherRef.current(), false, ttlMs).catch(() => {})

    let interval: number | undefined
    if (refreshMs > 0) {
      interval = window.setInterval(() => {
        void load(key, () => fetcherRef.current(), true, ttlMs).catch(() => {})
      }, refreshMs)
    }

    return () => {
      current.listeners.delete(listener)
      if (interval !== undefined) window.clearInterval(interval)
    }
  }, [enabled, key, refreshMs, ttlMs])

  return {
    data: entry.value,
    error: entry.error,
    loading: Boolean(entry.promise) && entry.value === undefined,
    refreshing: Boolean(entry.promise) && entry.value !== undefined,
    updatedAt: entry.updatedAt,
    refresh: () => load(key, () => fetcherRef.current(), true, ttlMs),
  }
}
