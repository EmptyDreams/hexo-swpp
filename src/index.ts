import * as fs from 'fs'
import Hexo from 'hexo'
import nodePath from 'path'
import {
    CompilationData, ConfigLoader, ResourcesScanner,
    RuntimeData, RuntimeException, SwCompiler,
    swppVersion, utils
} from 'swpp-backends'

interface PluginConfig {

    /** 是否启用，默认 false */
    enable?: boolean
    /** 配置文件名称，默认 "swpp.config.ts" */
    config_path?: string
    /** 是否生成 sw，默认 true */
    serviceWorker?: boolean
    /** 是否向所有 HTML 插入注册 sw 的代码，默认 true */
    auto_register?: boolean
    /** 是否生成 DOM 端的 JS 文件并在 HTML 中插入 script，默认 true */
    gen_dom?: boolean
    /** 生成的 diff 文件的路径（可以是绝对路径也可以是相对路径，使用相对路径时相对于网站发布目录），留空表示不生成 */
    gen_diff?: string
    /** 是否在执行 hexo deploy 时自动执行 swpp 指令，默认 false */
    auto_exec?: boolean
    /** 检查更新的网址，默认 "https://registry.npmjs.org"，注意不能以斜杠结尾 */
    npm_url?: string
    /**
     * 排序规则。
     *
     * 该配置项是为了对 hexo 中的一些变量进行排序，避免每次生成 HTML 时由于这些变量的顺序变动导致生成结果不完全相同。
     *
     * 示例：
     *
     * ```yaml
     * # 下面给出的值为插件的缺省值，用户设置该项不会直接覆盖这些值，只有用户也声明 posts、pages 或 tags 时才会覆盖对应的值。
     * swpp:
     *   sort_rules:
     *     posts: 'title'
     *     pages: 'title'
     *     tags: 'name'
     * ```
     *
     * 其中 key 值为要排序的变量的名称，value 为变量排序时的依据，
     * 填 false 表示禁用该项排序，填 true 表示以 value 本身为键进行排序，填字符串表示以 value[tag] 为键进行排序。
     */
    sort_rules?: {
        [name: string]: string | boolean
    }

}

const logger = require('hexo-log').default()

const CONSOLE_OPTIONS = [
    {name: '-t, --test', desc: '尝试拉取指定链接'},
    {name: '-b, --build', desc: '构建 swpp，留空参数与使用该参数效果一致'}
]

let runtimeData: RuntimeData
let compilationData: CompilationData
const configLoadWaitList: (() => void)[] = []

/** 等待配置加载 */
function waitUntilConfig(): Promise<void> {
    if (runtimeData) return Promise.resolve()
    return new Promise(resolve => configLoadWaitList.push(resolve))
}

function checkHexoConfig(config: any) {
    // 类型检查
    const typeMap: any = {
        'enable': 'boolean',
        'config_path': 'string',
        'serviceWorker': 'boolean',
        'auto_register': 'boolean',
        'gen_dom': 'boolean',
        'gen_diff': 'string',
        'auto_exec': 'boolean',
        'npm_url': 'string',
        'sort_rules': 'object',
    }
    for (let configKey in config) {
        const type = typeMap[configKey]
        if (!type) {
            throw new RuntimeException('error', `yml 配置项中存在非法字段，不存在 [${configKey}] 配置项，请检查是否拼写错误`)
        }
        if (typeof config[configKey] !== type) {
            throw new RuntimeException(
                'invalid_var_type',
                `yml 配置项类型错误，[${configKey}] 应当传入 ${type} 类型`,
                {your_value: config[configKey]}
            )
        }
    }
    // 特殊规则校验
    const pluginConfig = config as PluginConfig
    if (pluginConfig.gen_diff && !pluginConfig.gen_diff.endsWith('.json')) {
        throw new RuntimeException(
            'invalid_value',
            `yml 配置项中值非法，[gen_diff] 的值应当以 '.json' 结尾`,
            {your_value: pluginConfig.gen_diff}
        )
    }
    if (pluginConfig.npm_url && pluginConfig.npm_url.endsWith('/')) {
        throw new RuntimeException(
            'invalid_value',
            `yml 配置项中值非法，[npm_url] 的值不应当以 '/' 结尾`,
            {your_value: pluginConfig.npm_url}
        )
    }
}

/** 运行插件 */
async function start(hexo: Hexo) {
    // @ts-ignore
    globalThis.hexo = hexo
    const config = hexo.config
    const pluginConfig: PluginConfig = config['swpp'] ?? config.theme_config['swpp']
    if (!pluginConfig?.enable) return
    checkHexoConfig(pluginConfig)
    let init = false
    hexo.on('generateBefore', async () => {
        if (init) return
        init = true
        buildServiceWorker(hexo, pluginConfig)
        sort(hexo, pluginConfig)
        await initRules(hexo, pluginConfig)
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
                    const response = await compilationData.compilationEnv.read('NETWORK_FILE_FETCHER').fetch(test)
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
        if (build || !test) {
            try {
                await runSwpp(hexo, pluginConfig)
            } catch (e) {
                logger.error('执行 SWPP 指令时出现异常')
                console.error(e)
                process.exit(-1)
            }
        }
    })
    if (pluginConfig['auto_exec']) {
        hexo.on('deployBefore', async () => {
            try {
                await runSwpp(hexo, pluginConfig)
            } catch (e) {
                logger.error('执行 SWPP 指令时出现异常')
                console.error(e)
                process.exit(-1)
            }
        })
    }
}

async function initRules(hexo: Hexo, pluginConfig: PluginConfig) {
    if (!runtimeData) {
        try {
            await loadConfig(hexo, pluginConfig)
            configLoadWaitList.forEach(it => it())
            if (process.argv.find(it => 'server'.startsWith(it)))
                checkVersion(pluginConfig)
        } catch (e) {
            logger.error("[SWPP] 加载时遇到错误。")
            logger.error(e)
            process.exit(0x114514)
        }
    }
}

/** 运行 swpp 指令 */
async function runSwpp(hexo: Hexo, pluginConfig: PluginConfig) {
    const config = hexo.config
    if (!fs.existsSync(config.public_dir))
        return logger.warn(`[SWPP] 未检测到发布目录，跳过指令执行`)
    await initRules(hexo, pluginConfig)
    // 计算文件目录
    const jsonInfo = compilationData.compilationEnv.read('SWPP_JSON_FILE')
    const fileContent: Record<string, () => string> = {}
    fileContent[nodePath.join(hexo.config.public_dir, jsonInfo.swppPath, jsonInfo.versionPath)] = () => JSON.stringify(json)
    fileContent[nodePath.join(hexo.config.public_dir, jsonInfo.swppPath, jsonInfo.trackerPath)] = () => tracker.json()
    if (pluginConfig.gen_diff) {
        fileContent[nodePath.join(hexo.config.public_dir, pluginConfig.gen_diff)] = () => jsonBuilder.serialize()
    }
    // 检查目录是否存在
    for (let path in fileContent) {
        if (fs.existsSync(path)) {
            throw new RuntimeException('file_duplicate', `文件[${path}]已经存在`)
        }
    }
    // 扫描文件
    const scanner = new ResourcesScanner(compilationData)
    const tracker = await scanner.scanLocalFile(config.public_dir)
    const jsonBuilder = await tracker.diff()
    const json = await jsonBuilder.buildJson()
    // 生成数据文件
    await fs.promises.mkdir(nodePath.join(hexo.config.public_dir, jsonInfo.swppPath), { recursive: true })
    return Promise.all(
        Object.values(utils.objMap(fileContent, (value, key) => fs.promises.writeFile(key, value(), 'utf-8')))
    )
}

/** 检查 swpp-backends 的版本 */
function checkVersion(pluginConfig: PluginConfig) {
    const root = pluginConfig['npm_url'] ?? 'https://registry.npmjs.org'
    const fetcher = compilationData.compilationEnv.read('NETWORK_FILE_FETCHER')
    fetcher.fetch(`${root}/swpp-backends/${swppVersion}`)
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

/** 加载配置文件 */
async function loadConfig(hexo: Hexo, pluginConfig: PluginConfig) {
    const themeName = hexo.config.theme
    const loader = new ConfigLoader()
    const publishPath = hexo.config.public_dir
    await loader.loadFromCode({
        compilationEnv: {
            DOMAIN_HOST: new URL(hexo.config.root, hexo.config.url),
            PUBLIC_PATH: /[/\\]$/.test(publishPath) ? publishPath : publishPath + '/'
        }
    })
    const configPath = pluginConfig['config_path'] ?? 'swpp.config.ts'
    const configPaths = [configPath, `./themes/${themeName}/${configPath}`, `./node_modules/hexo-${themeName}/${configPath}`]
    const isDirectory = configPath.endsWith('/')
    for (let path of configPaths) {
        if (!fs.existsSync(path)) continue
        if (isDirectory) {
            const list = fs.readdirSync(path).sort()
            for (let uri of list) {
                await loader.load(nodePath.resolve(path, uri))
            }
        } else {
            await loader.load(nodePath.resolve(path))
        }
    }
    const result = loader.generate()
    runtimeData = result.runtime
    compilationData = result.compilation
}

/** 注册生成器 */
function buildServiceWorker(hexo: Hexo, hexoConfig: PluginConfig) {
    const {serviceWorker, auto_register, gen_dom} = hexoConfig
    // 生成 sw
    if (serviceWorker ?? true) {
        hexo.extend.generator.register('build_service_worker', async () => {
            await waitUntilConfig()
            return ({
                path: compilationData.compilationEnv.read('SERVICE_WORKER') + '.js',
                data: new SwCompiler().buildSwCode(runtimeData)
            })
        })
    }
    // 生成注册 sw 的代码
    if (auto_register ?? true) {
        waitUntilConfig().then(() => {
            hexo.extend.injector.register(
                'head_begin', `<script>(${runtimeData.domConfig.read('registry')})()</script>`
            )
        })
    }
    // 生成 sw-dom.js
    if (gen_dom ?? true) {
        hexo.extend.injector.register('head_end', () => {
            // noinspection HtmlUnknownTarget
            return `<script defer src="/sw-dom.js"></script>`
        })
        hexo.extend.generator.register('build_dom_js', async () => {
            await waitUntilConfig()
            return {
                path: 'sw-dom.js',
                data: runtimeData.domConfig.buildJsSource()
            }
        })
    }
}

/** 对 hexo 中的变量进行排序 */
function sort(hexo: Hexo, pluginConfig: PluginConfig) {
    const version = hexo.version
    let Locals: any
    if (version.startsWith('7')) {
        Locals = require(nodePath.resolve('node_modules/hexo/dist/hexo/locals')).prototype
    } else {
        Locals = require(nodePath.resolve('node_modules/hexo/lib/hexo/locals')).prototype
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
    Object.assign(list, pluginConfig.sort_rules ?? {})
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

start(hexo).catch(e => {
    logger.error("[SWPP] 加载时遇到严重错误！")
    logger.error(e)
    process.exit(0x19491001)
})