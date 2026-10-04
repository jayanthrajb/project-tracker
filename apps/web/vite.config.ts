import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { Plugin } from 'vite';

const constraintsId = 'virtual:attachment-constraints';
const attachmentRoute = path.resolve(__dirname, '../api/src/routes/attachments.ts');

function attachmentConstraints() {
  return {
    name: 'attachment-constraints',
    resolveId(id: string) {
      if (id === constraintsId) return `\0${constraintsId}`;
    },
    load(id: string) {
      if (id !== `\0${constraintsId}`) return;
      this.addWatchFile(attachmentRoute);
      const source = ts.createSourceFile(attachmentRoute, readFileSync(attachmentRoute, 'utf8'), ts.ScriptTarget.Latest, true);
      const names = ['MAX_FILE_SIZE', 'allowedMimeTypes'];
      const declarations = source.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => statement.declarationList.declarations)
        .filter((declaration) => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text));
      if (declarations.length !== names.length || declarations.some((declaration) => !declaration.initializer)) {
        throw new Error('Attachment constraints are missing from the API route');
      }
      return declarations.map((declaration) => `export const ${declaration.name.getText(source)} = ${declaration.initializer!.getText(source)};`).join('\n');
    },
  } satisfies Plugin;
}

export default defineConfig({
  plugins: [react(), attachmentConstraints()],
  envDir: path.resolve(__dirname, '../../'),
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
