import React from 'react'
// @ts-expect-error package subpath has no declaration file
import MessageSquare from 'lucide-react/dist/esm/icons/message-square.mjs'
// @ts-expect-error package subpath has no declaration file
import PencilLine from 'lucide-react/dist/esm/icons/pencil-line.mjs'
import { Button, Modal } from './antd-ui.js'

export interface CapabilityCreationDialogCopy {
  readonly title: string
  readonly hint: string
  readonly manual: string
  readonly manualHint: string
  readonly conversation: string
  readonly conversationHint: string
  readonly conversationBusy: string
  readonly cancel: string
}

export function CapabilityCreationDialog(props: {
  readonly open: boolean
  readonly copy: CapabilityCreationDialogCopy
  readonly onClose: () => void
  readonly onManual: () => void
  readonly onConversation?: () => Promise<void>
  readonly errorMessage: (cause: unknown) => string
}): React.ReactElement {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!props.open) setError(null)
  }, [props.open])

  const close = (): void => {
    if (!busy) props.onClose()
  }
  const createManually = (): void => {
    if (busy) return
    props.onClose()
    props.onManual()
  }
  const createWithConversation = (): void => {
    if (props.onConversation === undefined || busy) return
    setBusy(true)
    setError(null)
    void props.onConversation().then(props.onClose).catch((cause: unknown) => {
      setError(props.errorMessage(cause))
    }).finally(() => { setBusy(false) })
  }

  return <Modal
    open={props.open}
    title={props.copy.title}
    footer={null}
    centered
    width={560}
    destroyOnHidden
    closable={!busy}
    maskClosable={!busy}
    onCancel={close}
  >
    <div className="aag-create-expert">
      <p className="aag-create-expert-hint">{props.copy.hint}</p>
      {error === null ? null : <div className="aag-error" role="alert">{error}</div>}
      <div className="aag-create-expert-options">
        <button type="button" autoFocus disabled={busy} onClick={createManually}>
          <PencilLine size={22} strokeWidth={1.7} aria-hidden="true"/>
          <span><strong>{props.copy.manual}</strong><small>{props.copy.manualHint}</small></span>
        </button>
        <button type="button" disabled={busy || props.onConversation === undefined} onClick={createWithConversation}>
          <MessageSquare size={22} strokeWidth={1.7} aria-hidden="true"/>
          <span><strong>{busy ? props.copy.conversationBusy : props.copy.conversation}</strong><small>{props.copy.conversationHint}</small></span>
        </button>
      </div>
      <div className="aag-create-expert-footer">
        <Button disabled={busy} onClick={close}>{props.copy.cancel}</Button>
      </div>
    </div>
  </Modal>
}
