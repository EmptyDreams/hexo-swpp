import * as fs from 'fs'
import Hexo from 'hexo'
import nodePath from 'path'
import {
    CompilationData, ConfigLoader, FileUpdateTracker, ResourcesScanner,
    RuntimeData, SwCompiler,
    swppVersion
} from 'swpp-backends'

const logger = require('hexo-log').default()

const CONSOLE_OPTIONS = [
    {name: '-t, --test', desc: '尝试拉取指定链接'},
    {name: '-b, --build', desc: '构建 swpp，留空参数与使用该参数效果一致'}
]

let runtimeData: RuntimeData
let compilationData: CompilationData

async function start(hexo: Hexo) {
    const config = hexo.config
    const pluginConfig = config['swpp'] ?? config.theme_config['swpp']
    if (!pluginConfig?.enable) return
    if (process.argv.find(it => 'server'.startsWith(it)))
        checkVersion(pluginConfig)
    let init = false
    hexo.on('generateBefore', async () => {
        if (init) return
        init = true
        await loadConfig(hexo, pluginConfig)
        sort(hexo)
        buildServiceWorker(hexo, pluginConfig)
    })
    hexo.extend.console.register('swpp', 'Hexo Swpp 的相关指令', {
        options: CONSOLE_OPTIONS
    }, async args => {
        const test = args.t ?? args.test
        // noinspection JSUnresolvedReference
        const build = args.b ?? args.build
        if (test) {
            if (typeof test == 'boolean' || Array.isArray(test) || !/^(https?):\/\/(\S*?)\.(\S*?)(\S*)$/i.test(test)) {
                logger.error('[SWPP][CONSOLE] --test/-t 后应跟随一个有效 URL')
            } else {
                await initRules(hexo, pluginConfig)
                try {
                    const response = await compilationData.compilationEnv.read('FETCH_NETWORK_FILE').fetch(test)
                    if ([200, 301, 302, 307, 308].includes(response.status)) {
                        logger.info('[SWPP][LINK TEST] 资源拉取成功，状态码：' + response.status)
                    } else {
                        logger.warn('[SWPP][LINK TEST] 资源拉取失败，状态码：' + response.status)
                    }
                } catch (e) {
                    logger.warn('[SWPP][LINK TEST] 资源拉取失败', e)
                }
            }
        }
        if (build) {
            if (typeof build !== 'boolean') {
                logger.warn('[SWPP][CONSOLE] -build/-b 后方不应跟随参数')
            }
        }
        if (build || !test)
            await runSwpp(hexo, pluginConfig)
    })
    if (pluginConfig['auto_exec']) {
        hexo.on('deployBefore', async () => {
            await runSwpp(hexo, pluginConfig)
        })
    }
}

async function initRules(hexo: Hexo, pluginConfig: any) {
    if (!runtimeData) await loadConfig(hexo, pluginConfig)
}

async function runSwpp(hexo: Hexo, pluginConfig: any) {
    const config = hexo.config
    if (!fs.existsSync(config.public_dir))
        return logger.warn(`[SWPP] 未检测到发布目录，跳过指令执行`)
    await initRules(hexo, pluginConfig)
    const scanner = new ResourcesScanner(compilationData)
    const versionFile = compilationData.compilationEnv.read('SWPP_JSON_FILE')
    const [tracker, oldTracker] = await Promise.all([
        scanner.scanLocalFile(config.public_dir),
        FileUpdateTracker.parserJsonFromNetwork(compilationData)
    ])
    const jsonBuilder = tracker.diff(oldTracker)
    function writeFile(path: string, content: string): Promise<void> {
        return new Promise((resolve, reject) => {
            fs.writeFile(path, content, 'utf-8', (err) => {
                if (err) reject(err)
                else resolve()
            })
        })
    }
    const json = await jsonBuilder.buildJson()
    return Promise.all([
        writeFile(nodePath.join(hexo.config.public_dir, versionFile.versionPath), JSON.stringify(json)),
        writeFile(nodePath.join(hexo.config.public_dir, versionFile.trackerPath), tracker.json())
    ])
}

function checkVersion(pluginConfig: any) {
    const root = pluginConfig['npm_url'] ?? 'https://registry.npmjs.org'
    fetch(`${root}/swpp-backends/${swppVersion}`)
        .then(response => {
            if (![200, 301, 302, 307, 308].includes(response.status)) return Promise.reject(response.status)
            return response.json()
        }).then(json => {
            if ('error' in json) return Promise.reject(json.error)
            if ('deprecated' in json) {
                logger.warn(`[SWPP][VersionChecker] 您使用的 swpp-backends@${swppVersion} 已被弃用，请更新版本！`)
                logger.warn(`\t补充信息：${json['deprecated']}`)
                logger.warn('请注意！！！当您看到这条消息时，表明您正在使用的后台版本存在漏洞，请务必更新版本！！！')
                logger.info('可以使用 `npm update swpp-backends` 更新后台版本，或使用您自己常用的等效命令。')
            } else {
                logger.info('[SWPP VersionChecker] 版本检查通成功，您使用的版本目前没有被废弃，注意定期检查版本更新。')
            }
        }).catch(err => {
            const isSimple = ['number', 'string'].includes(typeof err)
            logger.warn(`[SWPP][VersionChecker] 版本检查失败${isSimple ? ('（' + err + '）'): ''}`)
            if (!isSimple)
                logger.warn(err)
        })
}

async function loadConfig(hexo: Hexo, pluginConfig: any) {
    const themeName = hexo.config.theme
    const loader = new ConfigLoader()
    const configName = pluginConfig['config_name'] ?? 'swpp.config'
    const configPaths = [configName, `./themes/${themeName}/${configName}`, `./node_modules/hexo-${themeName}/${configName}`]
    const extnameList = ['ts', 'js', 'cts', 'mts', 'cjs', 'mjs']
    for (let path of configPaths) {
        for (let extname of extnameList) {
            const uri = `${path}.${extname}`
            if (fs.existsSync(uri)) {
                await loader.load(uri)
                break
            }
        }
    }
    const result = loader.generate()
    runtimeData = result.runtime
    compilationData = result.compilation
}

function buildServiceWorker(hexo: Hexo, hexoConfig: any) {
    const {serviceWorker} = hexoConfig
    // 生成 sw
    if (serviceWorker ?? true) {
        hexo.extend.generator.register('build_service_worker', () => {
            return {
                path: typeof serviceWorker == 'string' ? serviceWorker : 'sw.js',
                data: new SwCompiler().buildSwCode(runtimeData)
            }
        })
    }
    // 生成注册 sw 的代码
    if (runtimeData.domConfig?.hasValue('registry')) {
        hexo.extend.injector.register(
            'head_begin',
            () => `(${runtimeData.domConfig.read('registry').toString()})()`
        )
    }
    // 生成 sw-dom.js
    if (runtimeData.domConfig) {
        // noinspection HtmlUnknownTarget
        hexo.extend.injector.register('head_end', `<script defer src="/sw-dom.js"></script>`)
        hexo.extend.generator.register('build_dom_js', () => {
            return {
                path: 'sw-dom.js',
                data: runtimeData.domConfig.buildJsSource()
            }
        })
    }
}

/** 对 hexo 中的变量进行排序 */
function sort(hexo: Hexo) {
    const version = hexo.version
    let Locals: any
    if (version.startsWith('7')) {
        Locals = require(nodePath.resolve('./', 'node_modules/hexo/dist/hexo/locals')).prototype
    } else {
        Locals = require(nodePath.resolve('./', 'node_modules/hexo/lib/hexo/locals')).prototype
    }
    type SortType = { length: number }
    const compare = (a: SortType, b: SortType) => {
        const result = a.length === b.length ? a < b : a.length < b.length
        return result ? -1 : 1
    }
    const sort = (obj: any, value: string | boolean, keyName: string) => {
        if (!obj || !value) return
        const target = obj.data ?? obj
        if ('sort' in target) {
            if (typeof value === 'boolean') {
                target.sort(compare)
            } else {
                target.sort((a: any, b: any) => compare(a[value], b[value]))
            }
        } else {
            const keyList = Object.getOwnPropertyNames(target)
            if (keyList.length === 0) return
            let comparator
            if (typeof value === 'boolean') {
                comparator = (a: any, b: any) => compare(a.value, b.value)
            } else if (typeof target[keyList[0]] == 'string') {
                if (value != 'name') {
                    return console.warn(`排序时出现问题，某个键（该键的 key 为“${keyName}”）的排序规则存在问题`)
                }
                comparator = (a: any, b: any) => compare(a.value, b.value)
            } else if (value in target[keyList[0]]) {
                comparator = (a: any, b: any) => compare(a.value[value], b.value[value])
            } else {
                return console.warn(`排序时出现问题，某个键（该键的 key 为“${keyName}”）的排序规则存在问题`)
            }
            const result = []
            for (let key of keyList) {
                result.push({
                    value: target[key],
                    id: key
                })
                delete target[key]
            }
            result.sort(comparator)
            for (let item of result) {
                target[item.id] = item.value
            }
        }
    }
    const list: { [propName: string]: string | boolean } = {
        posts: 'title',
        pages: 'title',
        tags: 'name'
    }
    // @ts-ignore
    Object.assign(list, swpp.cache.readRules().config['sort'] ?? {})
    const getter = Locals.get
    Locals.get = function (name: string) {
        const result = getter.call(this, name)
        if (name in list) sort(result, list[name], name)
        if ((typeof result == 'object') && 'forEach' in result) {
            result.forEach((it: any) => {
                for (let tag in list)
                    sort(it[tag], list[tag], tag)
            })
        }
        return result
    }
}

try {
    // noinspection JSIgnoredPromiseFromCall
    start(hexo)
} catch (e) {
    logger.error("[SWPP] 加载时遇到错误，可能是由于缺少规则文件。")
    logger.error(e)
    process.exit(114514)
}