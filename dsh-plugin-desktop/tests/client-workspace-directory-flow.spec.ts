// @vitest-environment jsdom
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceDirectoryFlow } from '../src/client/workspace-directory-flow.tsx'
import type { DirectoryFlowServices } from '../src/client/workspace-directory-flow.tsx'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await React.act(async () => root.unmount())
  document.body.replaceChildren()
})
const listing = (path = '/home/test/project'): DirectoryListing => ({
  path, home: '/home/test', truncated: false,
  crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }, { name: 'test', path: '/home/test', hidden: false }, { name: 'project', path, hidden: false }],
  entries: [{ name: 'child', path: `${path}/child`, hidden: false }, { name: '.hidden', path: `${path}/.hidden`, hidden: true }],
})
async function mount(overrides: Partial<DirectoryFlowServices> = {}) {
  const onPicked = vi.fn()
  const props = {
    open: true, busy: false, onPicked, onCancel: vi.fn(), onError: vi.fn(),
    startPath: () => '/home/test/project',
    listDirectory: vi.fn(async (path?: string) => listing(path)),
    createDirectory: vi.fn(async () => '/home/test/project/new'),
    t: (key: string) => key,
    ...overrides,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await React.act(async () => root.render(React.createElement(WorkspaceDirectoryFlow, props)))
  return props
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)
  expect(button).toBeDefined()
  await React.act(async () => button!.click())
}
it('starts at the selected workspace and trims breadcrumbs to home', async () => {
  const props = await mount()
  expect(props.listDirectory).toHaveBeenCalledWith('/home/test/project', expect.any(AbortSignal))
  expect(document.querySelector('nav')?.textContent).toBe('homeproject')
  expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('project')
  expect(document.querySelector('ul')?.textContent).not.toContain('.hidden')
  await click('child')
  await click('select')
  expect(props.onPicked).toHaveBeenCalledWith('/home/test/project/child')
})
it('falls back to home when the selected workspace cannot be read', async () => {
  const read = vi.fn(async (path?: string) => {
    if (path) throw new Error('missing')
    return listing('/home/test')
  })
  await mount({ listDirectory: read })
  expect(read).toHaveBeenCalledTimes(2)
  expect(read).toHaveBeenLastCalledWith(undefined, expect.any(AbortSignal))
})
it('native selection navigates without committing and cancellation preserves the directory', async () => {
  const pickNative = vi.fn(async (): Promise<string | null> => '/native')
  const props = await mount({ pickNative })
  await click('native')
  expect(props.onPicked).not.toHaveBeenCalled()
  expect((document.querySelector('input') as HTMLInputElement).value).toBe('/native')
  pickNative.mockResolvedValueOnce(null)
  await click('native')
  expect((document.querySelector('input') as HTMLInputElement).value).toBe('/native')
})
it('creates a child directory then navigates into it before confirmation', async () => {
  const props = await mount()
  await click('create')
  const input = document.querySelector('input[aria-label="name"]') as HTMLInputElement
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'new')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('save')
  expect(props.createDirectory).toHaveBeenCalledWith('/home/test/project', 'new')
  expect(props.onPicked).not.toHaveBeenCalled()
  await click('select')
  expect(props.onPicked).toHaveBeenCalledWith('/home/test/project/new')
})
