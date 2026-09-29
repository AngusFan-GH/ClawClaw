/** Same-origin endpoint used by Desktop channel and browse directory pickers. */
export const DESKTOP_DIRECTORY_PICKER_PATH = '/_dsh/desktop/pick-directory'

/** Same-origin endpoint used before either workspace picker accepts a path. */
export const DESKTOP_DIRECTORY_VALIDATOR_PATH = '/_dsh/desktop/validate-directory'

/** Display preferences for the native folder chooser. */
export interface DesktopDirectoryPickerOptions {
  readonly showHiddenFiles?: boolean
}

/** Successful native directory-picker response. */
export interface DesktopDirectoryPickerResponse {
  /** Absolute selected path, or null when the chooser was cancelled. */
  path: string | null
}

/** Renderer-selected path submitted for native volume validation. */
export interface DesktopDirectoryValidationRequest {
  readonly path: string
}

/** Native decision returned without exposing filesystem details to the renderer. */
export interface DesktopDirectoryValidationResponse {
  readonly allowed: boolean
}
