export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel }) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        id="confirm-modal"
        role="dialog"
        aria-modal="true"
        className="relative bg-white border border-zinc-200 rounded-none max-w-md w-full mx-4 p-8"
      >
        <h3 className="text-xl font-display font-bold text-zinc-950 tracking-tight mb-3">{title}</h3>
        <p className="text-sm font-mono text-zinc-600 mb-8 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100">
          <button
            id="confirm-modal-cancel"
            onClick={onCancel}
            className="px-6 py-2.5 text-[10px] font-mono uppercase tracking-widest text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-none hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
          >
            Cancel
          </button>
          <button
            id="confirm-modal-confirm"
            onClick={onConfirm}
            className="px-6 py-2.5 text-[10px] font-mono uppercase tracking-widest text-white bg-indigo-700 rounded-none hover:bg-indigo-800 transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
