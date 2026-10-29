/** Configuracao global dos testes. */
process.env.TZ = 'UTC';
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET ??= 'test-secret-para-sessoes-com-mais-de-32-caracteres';
process.env.APP_URL ??= 'http://app.localhost:5173';
process.env.PLATFORM_HOSTS ??= 'app.localhost,localhost';
