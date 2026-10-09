import { describe, expect, it } from 'vitest'
import {
  desktopWebServerHost,
  parseDesktopNetworkExposure,
} from '../src/desktop-network.ts'

describe('Desktop network boundary', () => {
  it('keeps the HTTP origin loopback while accepting legacy values for migration', () => {
    expect(parseDesktopNetworkExposure('lan')).toBe('lan')
    expect(desktopWebServerHost('lan')).toBe('127.0.0.1')
    expect(desktopWebServerHost('loopback')).toBe('127.0.0.1')
  })
})
