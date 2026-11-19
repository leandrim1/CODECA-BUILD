import { codeca } from '@/lib/codeca';
import { FormularioDeContato } from '@/components/FormularioDeContato';

export const revalidate = 3600;

export default async function Contato() {
  const contato = await codeca.contact.get();

  return (
    <main>
      <h1>Fale com a gente</h1>

      {contato.phone ? <p>Telefone: {contato.phone}</p> : null}
      {contato.email ? <p>E-mail: {contato.email}</p> : null}
      {contato.addressLine ? (
        <p>
          {contato.addressLine}
          {contato.city ? `, ${contato.city}` : ''}
        </p>
      ) : null}

      <FormularioDeContato />
    </main>
  );
}
