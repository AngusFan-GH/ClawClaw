/** Use the Desktop native dialog when composed, preserving standalone DSH behavior. */
export function channelDirectoryPicker(picker, desktopPicker) {
  return {
    ...picker,
    pickDirectory: (options) => {
      const pick = desktopPicker()
      return typeof pick === 'function' ? pick(options) : picker.pickDirectory()
    },
  }
}
