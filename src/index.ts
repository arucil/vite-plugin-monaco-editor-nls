import fs from 'fs';
import path from 'path';
import {Plugin} from 'vite';
import MagicString from 'magic-string';
import {Plugin as EsbuildPlugin} from 'esbuild';

export enum Locale {
    BG = 'bg',
    CS = 'cs',
    DE = 'de',
    EN_GB = 'en-gb',
    ES = 'es',
    FR = 'fr',
    HU = 'hu',
    ID = 'id',
    IT = 'it',
    JA = 'ja',
    KO = 'ko',
    NL = 'nl',
    PL = 'pl',
    PS = 'ps',
    PT_BR = 'pt-br',
    RU = 'ru',
    TR = 'tr',
    UK = 'uk',
    ZH_HANS = 'zh-hans',
    ZH_HANT = 'zh-hant',
}

export interface Options {
    locale: Locale;
}

/**
 * 在vite中dev模式下会使用esbuild对node_modules进行预编译，导致找不到映射表中的filepath，
 * 需要在预编译之前进行替换
 * @param options 替换语言包
 * @returns
 */
export function esbuildPluginMonacoEditorNls(
    options: Options
): EsbuildPlugin {
    const CURRENT_LOCALE_DATA = getLocalizeMapping(options.locale);

    return {
        name: 'esbuild-plugin-monaco-editor-nls',
        setup(build) {
            build.onLoad({filter: /esm[\\\/]vs[\\\/]nls\.js$/}, async () => {
                return {
                    contents: getLocalizeCode(CURRENT_LOCALE_DATA),
                    loader: 'js',
                };
            });

            build.onLoad(
                {filter: /monaco-editor[\\\/]esm[\\\/]vs.+\.js$/},
                async (args) => {
                    return {
                        contents: transformLocalizeFuncCode(
                            args.path,
                            CURRENT_LOCALE_DATA,
                        ),
                        loader: 'js',
                    };
                },
            );
        },
    };
}

function patchPath(path: string): string {
    return path.replace(/\\/g, '/').replace('/browser/', '/')
}

/**
 * 使用了monaco-editor-nls的语言映射包，把原始localize(data, message)的方法，替换成了localize(path, data, defaultMessage)
 * vite build 模式下，使用rollup处理
 * @param options 替换语言包
 * @returns
 */
export default function (options: Options): Plugin {
    const CURRENT_LOCALE_DATA = getLocalizeMapping(options.locale);

    return {
        name: 'rollup-plugin-monaco-editor-nls',

        enforce: 'pre',

        load(filepath) {
            if (filepath.endsWith('esm/vs/nls.js') ||
                filepath.endsWith('esm\\vs\\nls.js')) {
                const code = getLocalizeCode(CURRENT_LOCALE_DATA);
                return code;
            }
        },
        transform(code, filepath) {
            let m: RegExpExecArray | null
            if (
                !filepath.endsWith('esm/vs/nls.js') &&
                !filepath.endsWith('esm\\vs\\nls.js') &&
                (m = /monaco-editor[\\\/]esm[\\\/](vs.+)\.js$/.exec(filepath))
            ) {
                if (code.includes('localize(')) {
                    const path = patchPath(m[1])
                    if ((CURRENT_LOCALE_DATA as { [path: string]: object })[path]) {
                        code = code.replace(
                            /localize\(/g,
                            `localize('${path}', `,
                        );
                    }
                    return {
                        code: code,
                        /** 使用magic-string 生成 source map */
                        map: new MagicString(code).generateMap({
                            includeContent: true,
                            hires: true,
                            source: filepath,
                        }),
                    };
                }
            }
        },
    };
}

/**
 * 替换调用方法接口参数，替换成相应语言包语言
 * @param filepath 路径
 * @param CURRENT_LOCALE_DATA 替换规则
 * @returns
 */
function transformLocalizeFuncCode(
    filepath: string,
    CURRENT_LOCALE_DATA: object,
) {
    let code = fs.readFileSync(filepath, 'utf-8');
    const re = /monaco-editor[\\\/]esm[\\\/](.+)\.js$/;
    const m = re.exec(filepath)!
    const path = patchPath(m[1])
    if ((CURRENT_LOCALE_DATA as { [path: string]: object })[path]) {
        code = code.replace(/\blocalize\(/g, `localize('${path}', `);
    }
    return code;
}

/**
 * 获取语言包
 * @param locale 语言
 * @returns
 */
function getLocalizeMapping(locale: Locale): object {
    const localeDataPath = path.join(__dirname, `./locale/${locale}.json`)
    return JSON.parse(fs.readFileSync(localeDataPath, 'utf-8'))
}

/**
 * 替换代码
 * @param CURRENT_LOCALE_DATA 语言包
 * @returns
 */
function getLocalizeCode(CURRENT_LOCALE_DATA: object) {
    return `
        function _format(message, args) {
            var result;
            if (args.length === 0) {
                result = message;
            } else {
                result = String(message).replace(/\{(\\d+)\}/g, function (match, ...rest) {
                    var index = rest[0];
                    return typeof args[index] !== 'undefined' ? args[index] : match;
                });
            }
            return result;
        }

        export function localize(path, data, message, ...args) {
            const key = typeof data === 'object' ? data.key : data;
            data = ${JSON.stringify(CURRENT_LOCALE_DATA)} || {};
            message = (data[path] || {})[key] || message;
            return _format(message, args);
        }
    `;
}
