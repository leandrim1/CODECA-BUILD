import { useCallback, useState } from 'react';
import type { ApiError, FieldErrors } from '../services/api.js';

/**
 * Formulario controlado simples.
 *
 * A validacao de verdade acontece no servidor; o hook so guarda os valores e
 * exibe as mensagens por campo que a API devolve.
 */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }, []);

  const setMany = useCallback((patch: Partial<T>) => {
    setValues((current) => ({ ...current, ...patch }));
  }, []);

  const applyApiError = useCallback((error: ApiError) => {
    setErrors(error.fieldErrors);
  }, []);

  const reset = useCallback(
    (next?: T) => {
      setValues(next ?? initial);
      setErrors({});
    },
    [initial],
  );

  return { values, errors, setField, setMany, setValues, applyApiError, setErrors, reset };
}

/** Converte "" em null, para campos numericos e opcionais. */
export function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function textOrEmpty(value: string | null | undefined): string {
  return value ?? '';
}

/** Lista de textos a partir de um campo separado por virgula ou nova linha. */
export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 40);
}

export function formatList(items: readonly string[]): string {
  return items.join('\n');
}
