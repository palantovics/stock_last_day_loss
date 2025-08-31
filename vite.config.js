import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import generouted from '@generouted/react-router/plugin'
import postcssGlobalData from '@csstools/postcss-global-data'
import postcssPresetEnv from 'postcss-preset-env'
import browsers from '@github/browserslist-config'
import tailwindcss from '@tailwindcss/vite'
import { globSync } from 'glob'

export default defineConfig({
    plugins: [react(), generouted(), tailwindcss()],
    base: '/stock_last_day_loss/', // Add this line - use your repo name
    server: { port: 1234 },
    build: {
        outDir: 'dist', // Ensure output goes to dist/
        assetsDir: 'assets', // Organize assets in subdirectory
    },
    css: {
        postcss: {
            plugins: [
                postcssGlobalData({
                    files: globSync(
                        'node_modules/@primer/primitives/dist/css/**/*.css'
                    ),
                }),
                postcssPresetEnv({
                    stage: 2,
                    browsers,
                    // https://preset-env.cssdb.org/features/#stage-2
                    features: {
                        'nesting-rules': {
                            noIsPseudoSelector: true,
                        },
                        'focus-visible-pseudo-class': false,
                        'logical-properties-and-values': false,
                    },
                }),
            ],
        },
    },
})
