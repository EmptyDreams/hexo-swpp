import * as fs from 'fs'
import Hexo from 'hexo'
import fetch from 'node-fetch'
import swpp, {AnalyzeResult} from 'swpp-backends'
import nodePath from 'path'

const logger = require('hexo-log').default()

// noinspection JSUnusedGlobalSymbols
function start(hexo: Hexo) {
    const config = hexo.config
    const pluginConfig = config['swpp'] ?? config.theme_config['swpp']
    if (!pluginConfig.enable) return
    checkVersion()
    let init = false
    hexo.on('generateBefore', () => {
        if (init) return
        init = true
        loadRules(hexo)
        sort(hexo)
        buildServiceWorker(hexo)
    })
    if (pluginConfig['auto_exec']) {
        hexo.on('deployBefore', async () => {
            await runSwpp(hexo)
        })
    } else {
        hexo.extend.console.register('swpp', '生成前端更新需要的 json 文件及后端使用的版本文件', {}, async () => {
            await runSwpp(hexo)
        })
    }
}

async function runSwpp(hexo: Hexo) {
    const config = hexo.config
    if (!fs.existsSync(config.public_dir))
        return logger.warn(`[SWPP] 未检测到发布目录，跳过指令执行`)
    const rules = loadRules(hexo)
    if (!rules.config.json)
        return logger.error(`[SWPP] JSON 生成功能未开启，跳过指令执行`)
    const url = config.url
    await Promise.all([
        swpp.loader.loadUpdateJson(url + '/update.json'),
        swpp.loader.loadVersionJson(url + '/cacheList.json')
    ])
    await buildVersionJson(hexo)
    const dif = swpp.builder.analyzeVersion()
    await buildUpdateJson(hexo, dif)
}

function checkVersion() {
    fetch(`https://registry.npmjs.org/swpp-backends/${swpp.version}`)
        .then(response => {
            if (![200, 301, 302, 307, 308].includes(response.status)) return Promise.reject(response.status)
            return response.json()
        }).then(json => {
            if ('deprecated' in json) {
                logger.error(`[SWPP VersionChecker] 您使用的 swpp-backends@${swpp.version} 已被弃用，请更新版本！`)
                logger.error(`\t补充信息：${json['deprecated']}`)
            } else {
                logger.info('[SWPP VersionChecker] 版本检查通过，注意定期检查版本更新。')
            }
        }).catch(err => {
            const isNumber = typeof err === 'number'
            logger.warn(`[SWPP VersionChecker] 版本检查失败${isNumber ? ('（' + err + '）'): ''}`)
            if (!isNumber)
                logger.warn(err)
        })
}

function loadRules(hexo: Hexo) {
    const themeName = hexo.config.theme
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
    const result = swpp.loader.loadRules(
        './', 'sw-rules',
        [`./themes/${themeName}/`, `./node_modules/hexo-${themeName}/`]
    )
    swpp.builder.calcEjectValues(hexo)
    return result
}

async function buildUpdateJson(hexo: Hexo, dif: AnalyzeResult) {
    const url = hexo.config.url
    const json = swpp.builder.buildUpdateJson(url, dif)
    fs.writeFileSync(`${hexo.config.public_dir}/update.json`, JSON.stringify(json), 'utf-8')
    logger.info('成功生成：update.json')
}

async function buildVersionJson(hexo: Hexo) {
    const url = hexo.config.url
    let protocol, domain
    if (url.startsWith('https:')) {
        protocol = 'https://'
    } else {
        protocol = 'http://'
    }
    domain = url.substring(protocol.length, url.endsWith('/') ? url.length - 1 : url.length)
    // @ts-ignore
    const json = await swpp.builder.buildVersionJson(protocol, domain, nodePath.resolve('./', hexo.config.public_dir))
    fs.writeFileSync(`${hexo.config.public_dir}/cacheList.json`, JSON.stringify(json), 'utf-8')
    logger.info('成功生成：cacheList.json')
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
        hexo.extend.injector.register('body_begin', () => `<script async src="/sw-dom.js"></script>`)
        hexo.extend.generator.register('build_dom_js', () => {
            return {
                path: 'sw-dom.js',
                data: swpp.builder.buildDomJs()
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
    Object.assign(list, swpp.cache.readRules().config['sort'] ?? {})
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