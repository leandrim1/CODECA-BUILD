/**
 * Unico JavaScript do site publico.
 *
 * Menu, acordeao de perguntas e ampliacao de imagens funcionam sem script
 * (checkbox, <details> e :target). Este trecho serve apenas ao envio do
 * formulario de contato, e o formulario traz um <noscript> com telefone e
 * e-mail para quem nao tiver JavaScript.
 */
export const CLIENT_SCRIPT = `
(function(){
  var forms = document.querySelectorAll('form[data-ct-lead-form]');
  Array.prototype.forEach.call(forms, function (form) {
    var status = form.querySelector('[data-ct-status]');
    var button = form.querySelector('button[type="submit"]');
    var originalLabel = button ? button.textContent : '';

    function show(state, message) {
      if (!status) return;
      status.setAttribute('data-state', state);
      status.textContent = message;
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      var data = new FormData(form);
      var payload = {
        name: String(data.get('name') || ''),
        phone: String(data.get('phone') || ''),
        email: String(data.get('email') || ''),
        interestType: String(data.get('interestType') || 'outro'),
        message: String(data.get('message') || ''),
        sourcePath: String(data.get('sourcePath') || location.pathname),
        consent: data.get('consent') === 'true' || data.get('consent') === 'on',
        honeypot: String(data.get('honeypot') || '')
      };
      if (data.get('propertyId')) payload.propertyId = String(data.get('propertyId'));
      if (data.get('projectId')) payload.projectId = String(data.get('projectId'));
      if (data.get('serviceId')) payload.serviceId = String(data.get('serviceId'));

      if (button) { button.disabled = true; button.textContent = 'Enviando...'; }
      show('', '');

      fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response.json().catch(function () { return null; }).then(function (body) {
            return { ok: response.ok, body: body };
          });
        })
        .then(function (result) {
          if (result.ok) {
            form.reset();
            show('success', form.getAttribute('data-success') || 'Mensagem enviada.');
          } else {
            var message = result.body && result.body.error && result.body.error.message
              ? result.body.error.message
              : 'Nao foi possivel enviar agora. Tente novamente em alguns instantes.';
            show('error', message);
          }
        })
        .catch(function () {
          show('error', 'Falha de conexao. Verifique sua internet e tente novamente.');
        })
        .then(function () {
          if (button) { button.disabled = false; button.textContent = originalLabel; }
        });
    });
  });
})();
`;
