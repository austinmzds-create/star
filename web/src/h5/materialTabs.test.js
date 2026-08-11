import { describe, expect, it } from 'vitest'
import { materialTabQuery, normalizeMaterialTab } from './materialTabs'

describe('H5 material tab routing', () => {
  it('keeps valid material tabs from the route query', () => {
    expect(normalizeMaterialTab('video_ai')).toBe('video_ai')
    expect(normalizeMaterialTab(['video_output'])).toBe('video_output')
  })

  it('falls back to detail for unknown tabs', () => {
    expect(normalizeMaterialTab('unknown')).toBe('detail')
    expect(normalizeMaterialTab(undefined)).toBe('detail')
  })

  it('omits the query for the default detail tab', () => {
    expect(materialTabQuery('detail')).toEqual({})
    expect(materialTabQuery('video_ai')).toEqual({ tab: 'video_ai' })
  })

  it('only changes the tab query and keeps unrelated query params', () => {
    expect(materialTabQuery('video_ai', { source: 'share', tab: 'detail' })).toEqual({
      source: 'share',
      tab: 'video_ai',
    })
    expect(materialTabQuery('detail', { source: 'share', tab: 'video_ai' })).toEqual({
      source: 'share',
    })
  })
})
