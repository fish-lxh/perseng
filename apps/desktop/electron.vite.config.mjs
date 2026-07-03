import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import monacoEditorPluginRaw from 'vite-plugin-monaco-editor';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// vite-plugin-monaco-editor 在 ESM 环境下 default 导出在 .default
const monacoEditorPlugin = monacoEditorPluginRaw.default ?? monacoEditorPluginRaw;

export default defineConfig({
    main: {
        plugins: [
            externalizeDepsPlugin({
                exclude: [
                    // Don't externalize our internal alias
                    '~/**'
                ]
            })
        ],
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/main/bootstrap.ts')
                },
                output: {
                    format: 'es'
                }
            },
            // Ensure aliases are resolved in the build
            lib: {
                entry: resolve(__dirname, 'src/main/bootstrap.ts'),
                formats: ['es']
            }
        },
        resolve: {
            alias: {
                '~': resolve(__dirname, 'src')
            },
            preserveSymlinks: true
        }
    },
    preload: {
        plugins: [
            externalizeDepsPlugin()
        ],
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/preload/index.ts')
                },
                output: {
                    format: 'cjs', // Preload must be CommonJS
                    entryFileNames: 'preload.cjs'
                }
            }
        },
        resolve: {
            alias: {
                '~': resolve(__dirname, 'src')
            },
            preserveSymlinks: true
        }
    },
    renderer: {
        root: resolve(__dirname, 'src/view'),
        plugins: [
            monacoEditorPlugin({
                language: ['sql']
            })
        ],
        build: {
            rollupOptions: {
                input: {
                    resources: resolve(__dirname, 'src/view/index.html')
                }
            }
        },
        resolve: {
            alias: {
                '~': resolve(__dirname, 'src')
            },
            preserveSymlinks: true
        },
        server: {
            port: 3000
        }
    }
});
