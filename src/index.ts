import * as fs from 'fs'
import Hexo from 'hexo'
import swpp, {AnalyzeResult, ChangeExpression} from 'swpp-backends'
import nodePath from 'path'

const logger = require('hexo-log').default()

export interface HexoSwppUpdate {
    flag: any,
    force?: boolean,
    change?: ChangeExpression[],
    refresh?: string[]
}

// noinspection JSUnusedGlobalSymbols
function start(hexo: Hexo) {
    const {config} = hexo
    if (!(config['swpp']?.enable || hexo.theme.config['swpp']?.enable))
        return
    const themeName = config.theme
    swpp.event.addRulesMapEvent(rules => {
        if ('cacheList' in rules && !('cacheRules' in rules)) {
            rules.cacheRules = rules['cacheList']
            delete rules['cacheList']
        }
        if ('getCdnList' in rules && !('getRaceUrls' in rules)) {
            rules.getRaceUrls = rules['getCdnList']
            delete rules['getCdnList']
        }
    })
    const rules = swpp.loader.loadRules(
        './', 'sw-rules',
        [`./themes/${themeName}/`, `./node_modules/hexo-${themeName}/`]
    )
    swpp.builder.calcEjectValues(hexo)
    sort(hexo)
    buildServiceWorker(hexo)
    if (rules.config.json) {
        hexo.extend.console.register('swpp', '生成前端更新需要的 json 文件及后端使用的版本文件', {}, async () => {
            if (!fs.existsSync(hexo.config.public_dir))
                return logger.warn(`[SWPP] 未检测到发布目录，跳过指令执行`)
            const url = hexo.config.url
            await swpp.loader.loadUpdateJson(url + '/update.json')
            const versionJson = await swpp.loader.loadVersionJson(url + '/cacheList.json')
            let forceRefreshCache = false
            if ('update' in rules) {
                const update: HexoSwppUpdate = rules.update
                const {flag, change, refresh, force} = update
                if (!flag) {
                    logger.error(`[SWPP Console] 规则文件的 update 项目必须包含 flag 值！`)
                    throw 'update.flag 缺失'
                }
                swpp.event.submitCacheInfo('flag', flag)
                if (flag !== versionJson.external.flag) {
                    if (change)
                        swpp.event.submitChange(...change)
                    if (refresh)
                        refresh.forEach(swpp.event.refreshUrl)
                    if (force) forceRefreshCache = true
                }
            }
            await buildVersionJson(hexo)
            const dif = swpp.builder.analyze(swpp.cache.readNewVersionJson())
            if (forceRefreshCache)
                dif.force = true
            await buildUpdateJson(hexo, dif)
        })
    }
}

async function buildUpdateJson(hexo: Hexo, dif: AnalyzeResult) {
    const url = hexo.config.url
    const json = swpp.builder.buildNewInfo(url, dif)
    fs.writeFileSync(`${hexo.config.public_dir}/update.json`, JSON.stringify(json), 'utf-8')
}

async function buildVersionJson(hexo: Hexo) {
    const url = hexo.config.url
    let protocol, domain
    if (url.startsWith('https:')) {
        protocol = 'https://'
        domain = url.substring(protocol.length)
    } else {
        protocol = 'http://'
        domain = url.substring(protocol.length)
    }
    // @ts-ignore
    const json = await swpp.builder.buildVersionJson(protocol, domain, nodePath.resolve('./', hexo.config.public_dir))
    fs.writeFileSync(`${hexo.config.public_dir}/cacheList.json`, JSON.stringify(json), 'utf-8')
}

function buildServiceWorker(hexo: Hexo) {
    const rules = swpp.cache.readRules()
    const pluginConfig = rules.config
    // 生成 sw
    if (pluginConfig.serviceWorker) {
        hexo.extend.generator.register('build_service_worker', () => {
            return {
                path: 'sw.js',
                data: swpp.builder.buildServiceWorker()
            }
        })
    }
    // 生成注册 sw 的代码
    if (pluginConfig.register) {
        hexo.extend.injector.register(
            'head_begin',
            () => pluginConfig.register!.builder(hexo.config.url, hexo, pluginConfig)
        )
    }
    // 生成 sw-dom.js
    if (pluginConfig.dom) {
        // noinspection HtmlUnknownTarget
        hexo.extend.injector.register('body_begin', () => `<script src="/sw-dom.js"></script>`)
        hexo.extend.generator.register('build_dom_js', () => {
            const template = fs.readFileSync(
                nodePath.resolve('./', 'node_modules/swpp-backends/dist/resources/sw-dom.js'),
                'utf-8'
            ).replaceAll(`// \${onSuccess}`, `(${pluginConfig.dom!.onsuccess.toString()})()`)
            return {
                path: 'sw-dom.js',
                data: template
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
    const sort = (obj: any, value: string | boolean) => {
        if (!obj) return
        const target = obj.data ?? obj
        if (!target.sort) return
        if (typeof value === 'boolean') {
            if (value) target.sort(compare)
        } else {
            target.sort((a: any, b: any) => compare(a[value], b[value]))
        }
    }
    const list: { [propName: string]: string | boolean } = {
        posts: 'title',
        pages: 'title',
        tags: 'name'
    }
    // @ts-ignore
    Object.assign(list, swpp.cache.readRules().config['sort'])
    const getter = Locals.get
    Locals.get = function (name: string) {
        const result = getter.call(this, name)
        if (name in list) sort(result, list[name])
        if ('forEach' in result) {
            result.forEach((it: any) => {
                for (let tag in list)
                    sort(it[tag], list[tag])
            })
        }
        return result
    }
}

try {
    // noinspection TypeScriptUnresolvedReference
    // @ts-ignore
    start(hexo)
} catch (e) {
    logger.error("[SWPP] 加载时遇到错误，可能是由于缺少规则文件。")
    logger.error(e)
    process.exit(114514)
}