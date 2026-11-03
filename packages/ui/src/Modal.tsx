import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button.js';
import { cx } from './utils.js';

/**
 * Dialogo acessivel.
 *
 * Usa o elemento <dialog> nativo: foco preso dentro do dialogo, fechamento com
 * Esc e fundo inerte vem do proprio navegador.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    return () => dialog.removeEventListener('cancel', handleCancel);
  }, [onClose]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      className={cx(
        'w-[calc(100vw-2rem)] rounded-2xl border border-slate-200/70 bg-white p-0 shadow-overlay',
        // So quando aberto (`open:`): `flex` solto mostraria o dialogo fechado.
        // Cabecalho e rodape ficam presos e so o miolo rola, e a altura nunca
        // passa da tela -- no celular o rodape com os botoes saia dela.
        'open:flex open:max-h-[calc(100dvh-2rem)] open:flex-col',
        // O reset do Tailwind zera a margem, e o `<dialog>` perde o `margin: auto`
        // do navegador que o centraliza: ele ficava colado no canto superior esquerdo.
        'm-auto',
        'backdrop:bg-slate-900/40 backdrop:backdrop-blur-sm',
        widths[size],
      )}
      // Clicar fora fecha, sem fechar ao clicar dentro.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-200/70 px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <h2 id="modal-title" className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      {children ? <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div> : null}
      {footer ? (
        <div className="flex flex-none flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">{footer}</div>
      ) : null}
    </dialog>
  );
}

/**
 * Confirmacao antes de uma acao destrutiva.
 * Nenhuma exclusao da aplicacao acontece sem passar por aqui.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{message}</div>
    </Modal>
  );
}
