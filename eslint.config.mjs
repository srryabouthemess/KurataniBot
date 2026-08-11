import js from '@eslint/js';

/**
 * Configuração enxuta de propósito: só o que pega ERRO.
 *
 * Nada de estilo (aspas, vírgula final, largura de linha) — isso é gosto, e um
 * linter opinando sobre gosto num projeto que nunca teve um só produz centenas
 * de apontamentos que ninguém lê. O `js.configs.recommended` do próprio ESLint
 * já é exatamente esse recorte: variável não definida, variável não usada,
 * código inalcançável, chave duplicada em objeto, `catch` vazio mal escrito.
 *
 * O ganho concreto em relação ao que já existe: `node --check` só valida
 * SINTAXE. Um `raw is not defined` — que aconteceu de verdade aqui, ao apagar
 * uma linha durante uma refatoração — passa pelo --check e só estoura quando
 * aquele caminho roda.
 */
export default [
  {
    ignores: ['node_modules/**', '*.migrated'],
  },

  js.configs.recommended,

  {
    // Só os .js do projeto são CommonJS; este próprio arquivo é ESM.
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        // Node, declarados na mão para não precisar do pacote `globals` só
        // por isto. Se faltar algum, o sintoma é um no-undef falso.
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        structuredClone: 'readonly',
      },
    },

    rules: {
      // `catch {}` sem binding é intencional em vários pontos ("se falhar,
      // segue o padrão") — o vazio ali é a decisão, não esquecimento.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // Argumento não usado costuma ser assinatura de callback que precisa
      // existir para chegar no próximo parâmetro.
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_' }],
    },
  },
];
