import { codeca } from '@/lib/codeca';
import { FormularioDeContato } from '@/components/FormularioDeContato';
import { CodecaMap } from '@/components/CodecaMap';

export const revalidate = 3600;

export default async function Contato() {
  const contato = await codeca.contact.get();

  return (
    <main>
      <h1>Fale com a gente</h1>

      {contato.phone ? <p>Telefone: {contato.phone}</p> : null}
      {contato.email ? <p>E-mail: {contato.email}</p> : null}
      {/*
        O mapa ja vem com o endereco em texto e os botoes "Como chegar", e
        continua mostrando os dois se o mapa nao carregar. Nao precisa repetir
        o endereco aqui.
      */}
      <CodecaMap contato={contato} />

      <FormularioDeContato />
    </main>
  );
}
