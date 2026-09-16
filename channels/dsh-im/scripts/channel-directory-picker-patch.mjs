/** Add the Desktop native shortcut to the pinned channel browse component at build time. */
export function patchChannelDirectoryPicker(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Pinned channel directory picker changed: ' + before)
    source = source.replace(before, after)
  }
  replace('  busy = false,', '  busy: saveBusy = false,')
  replace('  const [listing, setListing] = React.useState(null);',
    '  const [nativePicking, setNativePicking] = React.useState(false);\n  const busy = saveBusy || nativePicking;\n  const [listing, setListing] = React.useState(null);')
  replace('  if (!open) return null;', `  const pickNative = async () => {
    if (busy || loading) return;
    const request = requestRef.current;
    setNativePicking(true);
    setError(null);
    try {
      const path = await picker.pickDirectory({ showHiddenFiles: showHidden });
      if (path !== null && request === requestRef.current) await loadDirectory(path);
    } catch (cause) {
      if (request === requestRef.current) setError(pickerErrorMessage(cause));
    } finally {
      setNativePicking(false);
    }
  };

  if (!open) return null;`)
  replace("        h('input', {", `        h('div', { className: 'dim-directoryPathField' },
        typeof picker.pickDirectory === 'function' ? h('button', {
          type: 'button',
          className: 'ccDirectoryNativePicker',
          title: '使用系统选择器',
          'aria-label': '使用系统选择器',
          'aria-busy': nativePicking,
          disabled: busy || loading,
          onClick: () => void pickNative(),
        }, h(FolderIcon)) : null,
        h('input', {`)
  replace("        }),\n        h('button', {\n          type: 'submit',",
    "        })),\n        h('button', {\n          type: 'submit',")
  return source
}

export const channelDirectoryPickerPatch = {
  name: 'clawclaw-channel-directory-picker',
  setup(build) {
    build.onLoad({ filter: /[/\\]plugin-src[/\\]client[/\\]workspace-directory-picker\.js$/ }, async ({ path }) => {
      const { readFile } = await import('node:fs/promises')
      return { contents: patchChannelDirectoryPicker(await readFile(path, 'utf8')), loader: 'js' }
    })
  },
}
