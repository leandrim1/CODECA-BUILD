import { revalidateTag } from 'next/cache';
import { CodecaError, CODECA_SIGNATURE_HEADER, verifyWebhook } from '@codeca/sdk/server';
import { ETIQUETA_CONTEUDO } from '@/lib/codeca';

/**
 * Aviso de publicacao: o site revalida o cache sozinho.
 *
 * Sem isto, o cliente edita no painel e nao ve mudanca ate o cache expirar --
 * e a conclusao dele e que o painel nao funciona.
 */
export async function POST(request: Request) {
  try {
    const evento = await verifyWebhook({
      /*
        O corpo CRU, e nao `await request.json()`.
        Reserializar muda espacamento e ordem das chaves, e a assinatura
        deixa de conferir -- com um erro que parece de credencial.
      */
      rawBody: await request.text(),
      signature: request.headers.get(CODECA_SIGNATURE_HEADER),
      secret: process.env.CODECA_WEBHOOK_SECRET ?? '',
    });

    /*
      O segundo argumento e o perfil de cache, obrigatorio desde o Next 16.
      `{ expire: 0 }` diz "vence agora": o conteudo acabou de mudar no painel,
      e deixar qualquer sobrevida faria o cliente publicar e nao ver.
    */
    revalidateTag(ETIQUETA_CONTEUDO, { expire: 0 });

    return Response.json({ ok: true, modulo: evento.moduleKey });
  } catch (erro) {
    /*
      Assinatura invalida vira 401, e nao 200.
      Responder 200 a uma requisicao nao assinada deixaria qualquer um na
      internet invalidar o cache do site quando quisesse.
    */
    if (erro instanceof CodecaError) {
      return Response.json({ error: erro.message }, { status: 401 });
    }
    throw erro;
  }
}
