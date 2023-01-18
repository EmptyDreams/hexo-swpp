// noinspection JSUnresolvedVariable

"use strict"

const fs = require('fs')
const logger = require('hexo-log')()
const fetch = require('node-fetch')
const nodePath = require('path')
const crypto = require("crypto")
const cheerio = require('cheerio')
const postcss = require('postcss')

const findScript = () => nodePath.resolve('./', 'sw-rules')

const config = hexo.config
const pluginConfig = config.swpp || hexo.theme.config
const root = config.url + (config.root ?? '/')
const domain = new URL(root).hostname
const {
    cacheList,
    modifyRequest,
    fetchNoCache,
    getCdnList,
    getSpareUrls
} = pluginConfig?.enable ? require(findScript()) : {}

if (pluginConfig?.enable) {
    // 生成 update.json
    hexo.extend.console.register('swpp', '生成前端更新需要的 json 文件以及相关缓存', {}, async () => {
        if (!fs.existsSync(config.public_dir))
            return logger.info('未检测到发布目录，跳过 swpp 执行')
        const cachePath = 'cacheList.json'
        const updatePath = 'update.json'
        const oldCache = await getJsonFromNetwork(cachePath)
        const oldUpdate = await getJsonFromNetwork(updatePath)
        const newCache = await buildNewJson(cachePath)
        const dif = compare(oldCache, newCache)
        buildUpdateJson(updatePath, dif, oldUpdate)
    })

    // 生成 sw.js
    hexo.extend.generator.register('buildSw', () => {
        if (pluginConfig.sw.custom) return
        const absPath = module.path + '/sw-template.js'
        const rootPath = nodePath.resolve('./')
        const relativePath = nodePath.relative(rootPath, absPath)
        // 获取拓展文件
        let cache = fs.readFileSync('sw-rules.js', 'utf8')
            .replaceAll('module.exports.', 'const ')
        if (!fetchNoCache) {
            if (pluginConfig.sw.cdnRacing && getCdnList) {
                cache +=`
                    const fetchFile = (request, banCache) => {
                        const list = getCdnList(request.url)
                        if (!list || !Promise.any) return fetch(request, {cache: banCache ? 'no-store' : 'default'})
                        const res = list.map(url => new Request(url, request))
                        const controllers = []
                        return Promise.any(res.map(
                            (it, index) => fetch(it, {
                                cache: "no-store",
                                signal: (controllers[index] = new AbortController()).signal
                            }).then(response => response.status < 303 ? {index, response} : Promise.reject())
                        )).then(it => {
                            for (let i in controllers) {
                                if (i != it.index) controllers[i].abort()
                            }
                            return it.response
                        })
                    }
                `
            } else if (pluginConfig.sw.spareUrl && getSpareUrls) {
                cache += `
                    const fetchFile = (request, banCache, spare = null) => new Promise((resolve, reject) =>  {
                        if (!spare)
                            spare = getSpareUrls(request.url)
                        if (!spare) return fetch(request, {cache: banCache ? 'no-store' : 'default'})
                        const list = spare.list
                        const controllers = []
                        let index = 0
                        let error = 0
                        const plusError = () => {
                            if (++error === list.length) reject(\`请求 \${request.url} 失败\`)
                        }
                        const pull = () => {
                            if (index === list.length) return
                            const flag = ++index
                            controllers.push({
                                ctrl: new AbortController(),
                                id: setTimeout(pull, spare.timeout)
                            })
                            fetch(new Request(list[flag - 1], request)).then(response => {
                                if (response.status < 303) {
                                    for (let i in controllers) {
                                        if (i !== flag) {
                                            controllers[i].ctrl.abort()
                                            clearTimeout(controllers[i].id)
                                        }
                                    }
                                    resolve(response)
                                } else plusError()
                            }).catch(plusError)
                        }
                        pull()
                    })
                `
            } else cache += '\nconst fetchFile = (request, banCache) => fetch(request, {cache: banCache ? "no-store" : "default"})'
        }
        if (!modifyRequest) cache += '\nconst modifyRequest = _ => {}'
        const swContent = fs.readFileSync(relativePath, 'utf8')
            .replaceAll("const { cacheList, modifyRequest, fetchFile, getSpareUrls } = require('../sw-rules')", cache)
            .replaceAll("'@$$[escape]'", (pluginConfig.sw.escape ?? 0).toString())
            .replaceAll("'@$$[cacheName]'", `'${pluginConfig.sw.cacheName ?? 'kmarBlogCache'}'`)
        return {
            path: 'sw.js',
            data: swContent
        }
    })

    // 生成注册 sw 的代码
    hexo.extend.injector.register('head_begin', () => {
        return `<script>
              (() => {
                const sw = navigator.serviceWorker
                const error = () => ${pluginConfig.sw.onerror}
                if (!sw?.register('${new URL(root).pathname}sw.js')?.then(() => {
                  if (!sw.controller) ${pluginConfig.sw.onsuccess}
                })?.catch(error)) error()
              })()
          </script>`
    }, "default")

    if (!pluginConfig.dom?.custom) {
        hexo.extend.injector.register('body_begin', () => {
            // noinspection HtmlUnknownTarget
            return `<script src="/sw-dom.js"></script>`
        })
        hexo.extend.generator.register('buildDomJs', () => {
            const absPath = module.path + '/sw-dom.js'
            const rootPath = nodePath.resolve('./')
            const relativePath = nodePath.relative(rootPath, absPath)
            const template = fs.readFileSync(relativePath, 'utf-8')
                .replaceAll('// ${onSuccess}', pluginConfig.dom.onsuccess)
            return {
                path: 'sw-dom.js',
                data: template
            }
        })
    }
}

/** 遍历指定目录下的所有文件 */
const eachAllFile = (root, cb) => {
    const stats = fs.statSync(root)
    if (stats.isFile()) cb(root)
    else {
        const files = fs.readdirSync(root)
        files.forEach(it => eachAllFile(nodePath.join(root, it), cb))
    }
}

/** 判断指定文件是否需要排除 */
const isExclude = pathname => {
    for (let reg of pluginConfig.exclude) {
        if (pathname.match(new RegExp(reg, 'i'))) return true
    }
    return false
}

const isSkipFetch = url => {
    const skipList = pluginConfig.external?.skip
    if (!skipList) return false
    for (let reg of skipList) {
        if (url.match(new RegExp(reg))) return true
    }
    return false
}

/**
 * 构建 md5 缓存表并写入到发布目录中
 *
 * 格式为 `{"[path]": "[md5Value]"}`
 *
 * @param path 相对于根目录的路径
 * @return {Promise<Object>} 生成的 json 对象
 */
const buildNewJson = path => new Promise(resolve => {
    const result = {}                   // 存储新的 MD5 表
    const removeIndex = config.pretty_urls?.trailing_index
    const removeHtml = config.pretty_urls?.trailing_html
    const taskList = []                 // 拉取任务列表
    const cache = new Set()             // 已经计算过的文件
    eachAllFile(config.public_dir, path => {
        if (!fs.existsSync(path)) return logger.error(`${path} 不存在！`)
        let endIndex
        if (removeIndex && path.endsWith('/index.html')) endIndex = path.length - 10
        else if (removeHtml && path.endsWith('.html')) endIndex = path.length - 5
        else endIndex = path.length
        const url = new URL(nodePath.join(root, path.substring(7, endIndex)))
        if (isExclude(url.href)) return
        let content = null
        if (findCache(url)) {
            content = fs.readFileSync(path, 'utf-8')
            const key = decodeURIComponent(url.pathname)
            result[key] = crypto.createHash('md5').update(content).digest('hex')
        }
        // 外链监控
        const external = pluginConfig.external
        if (!pluginConfig.external?.enable) return
        const indexOf = (str, ...chars) => {
            let result = str.length
            chars.forEach(it => {
                const index = str.indexOf(it)
                result = Math.min(result, index < 0 ? result : index)
            })
            return result
        }
        const lastIndexOf = (str, ...chars) => {
            let result = -1
            chars.forEach(it => result = Math.max(result, str.lastIndexOf(it)))
            return result
        }
        // 处理指定链接
        const handleLink = link => {
            // 跳过本地文件的计算
            if (!link.match(/^(http|\/\/)/) || cache.has(link)) return
            cache.add(link)
            const url = new URL(link.startsWith('/') ? `http:${link}` : link)
            if (url.hostname === domain || !findCache(url) || isExclude(url.href)) return
            if (isSkipFetch(url.href)) result[decodeURIComponent(link)] = '0'
            else taskList.push(
                fetchFile(link)
                    .then(response => response.text())
                    .then(text => {
                        const key = decodeURIComponent(link)
                        result[key] = crypto.createHash('md5').update(text).digest('hex')
                        if (key.endsWith('.js')) handleJsContent(text)
                        else if (key.endsWith('.css')) handleCssContent(text)
                    }).catch(err => logger.error(`拉取 ${err.url} 时出现 ${err.status ?? '未知'} 异常：${err}`))
            )
        }
        // 处理指定 JS
        const handleJsContent = text => {
            if (!external.js) return
            if (cache.has(text)) return
            cache.add(text)
            external.js.forEach(it => {
                const reg = new RegExp(`${it.head}(['"\`])(.*?)\\1${it.tail}`, 'mg')
                text.match(reg)?.forEach(content => {
                    try {
                        const start = indexOf(content, "'", '"', '`') + 1
                        const end = lastIndexOf(content, "'", '"', '`')
                        const link = content.substring(start, end)
                        if (!link.match(/['"$`]/)) handleLink(link)
                    } catch (e) {
                        logger.error(`SwppJsHandler: 处理 ${content} 时出现异常`)
                        logger.error(e)
                    }
                })
            })
        }
        // 处理 CSS 内容
        const handleCssContent = text => {
            if (cache.has(text)) return
            cache.add(text)
            postcss.parse(text).walkDecls(decl => {
                if (decl.value.includes('url')) {
                    decl.value.match(/url\(([^)]+)\)/g)
                        .map(it => it.match(/^(url\(['"])/) ? it.substring(5, it.length - 2) : it.substring(4, it.length - 1))
                        .forEach(link => handleLink(link))
                }
            })
        }
        // 如果是 html 则获取所有 script 和 link 标签拉取的文件
        if (path.endsWith('/') || path.endsWith('.html')) {
            if (!content) content = fs.readFileSync(path, 'utf-8')
            const html = cheerio.load(content)
            html('script[src]')
                .map((i, ele) => html(ele).attr('src'))
                .each((i, it) => handleLink(it))
            html('link[href]')
                .map((i, ele) => html(ele).attr('href'))
                .each((i, it) => handleLink(it))
            html('script:not([src])')
                .map((i, ele) => html(ele).text())
                .each((i, text) => handleJsContent(text))
            html('style')
                .map((i, ele) => html(ele).text())
                .each((i, text) => handleCssContent(text))
        } else if (path.endsWith('.js')) {
            if (!content) content = fs.readFileSync(path, 'utf-8')
            handleJsContent(content)
        } else if (path.endsWith('.css')) {
            if (!content) content = fs.readFileSync(path, 'utf-8')
            handleCssContent(content)
        }
    })
    Promise.all(taskList).then(() => {
        const publicRoot = config.public_dir
        fs.writeFileSync(nodePath.join(publicRoot, path), JSON.stringify(result), 'utf-8')
        logger.info(`Generated: ${path}`)
        resolve(result)
    })
})

/**
 * 从网络拉取一个文件
 * @param link 文件链接
 * @returns {Promise<*>} response
 */
const fetchFile = link => new Promise((resolve, reject) => {
    link = replaceDevRequest(link)
    // noinspection SpellCheckingInspection
    fetch(link, {
        headers: {
            referer: new URL(link).hostname,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 Edg/107.0.1418.62'
        },
        timeout: pluginConfig.external.timeout ?? 1500
    }).then(response => {
        switch (response.status) {
            case 200: case 301: case 302:
                resolve(response)
                break
            default:
                reject(response)
                break
        }
    }).catch(err => {
        err.url = link
        reject(err)
    })
})

/**
 * 从网络拉取 json 文件
 * @param path 文件路径（相对于根目录）
 */
const getJsonFromNetwork = path => new Promise(resolve => {
    const url = nodePath.join(root, path)
    fetchFile(url)
        .then(response => resolve(response.json()))
        .catch(err => {
            if (err.status === 404) {
                logger.error(`拉取 ${err.url} 时出现 404，如果您是第一次构建请忽略这个错误`)
                resolve()
            } else throw err
        })
})

/**
 * 对比两个 md5 缓存表的区别
 * @return [string] 需要更新的文件路径
 */
const compare = (oldCache, newCache) => {
    const result = []
    if (!oldCache) return result
    for (let path in oldCache) {
        if (newCache[path] !== oldCache[path]) result.push(path)
    }
    return result
}

/** 判断指定资源是否需要合并 */
const isMerge = (pathname, tidied) => {
    const optional = pluginConfig.merge
    if (pathname.includes(`/${config.tag_dir}/`)) {
        if (optional.tags ?? true) {
            tidied.tags = true
            return true
        }
    } else if (pathname.includes(`/${config.archive_dir}/`)) {
        if (optional.archives ?? true) {
            tidied.archives = true
            return true
        }
    } else if (pathname.includes(`/${config.category_dir}/`)) {
        if (optional.categories ?? true) {
            tidied.categories = true
            return true
        }
    } else if (pathname.startsWith('/page/') || pathname.length <= 1) {
        if (optional.index ?? true) {
            tidied.index = true
            return true
        }
    }
}

/**
 * 从一个字符串中提取最后两个 / 之间的内容
 * @param it {string} 要操作的字符串
 * @param keep {boolean} 是否保留最后一个 / 及其后面的内容
 */
const clipPageName = (it, keep) => {
    const end = it.lastIndexOf('/')
    let index = end - 1
    for (; index > 0; --index) {
        if (it[index] === '/') break
    }
    return it.substring(index + 1, keep ? it.length : end)
}

/** 构建新的 update.json */
const buildUpdateJson = (name, dif, oldUpdate) => {
    /** 将对象写入文件，如果对象为 null 或 undefined 则跳过写入 */
    const writeJson = json => {
        if (json) {
            logger.info(`Generated: ${name}`)
            fs.writeFileSync(`public/${name}`, JSON.stringify(json), 'utf-8')
        }
    }
    // 读取拓展 json
    const expand = fs.existsSync(name) ? JSON.parse(fs.readFileSync(name, 'utf-8')) : undefined
    // 获取上次最新的版本
    let oldVersion = oldUpdate?.info?.at(0)?.version ?? 0
    if (typeof oldVersion !== 'number') {
        // 当上次最新的版本号不是数字是尝试对其进行转换，如果无法转换则直接置零
        if (oldVersion.match('\D')) oldVersion = 0
        else oldVersion = Number.parseInt(oldVersion)
    }
    // 存储本次更新的内容
    const newInfo = {
        version: oldVersion + 1,
        change: expand?.change ?? []
    }
    // 整理更新的数据
    const tidied = tidyDiff(dif, expand)
    if (expand?.all) return writeJson({
        global: (oldUpdate?.global ?? 0) + (tidied.updateGlobal ? 1 : 0),
        info: [newInfo]
    })
    // 如果没有更新的文件就直接退出
    if (
        tidied.page.size === 0 && tidied.file.size === 0 &&
        !(tidied.archives || tidied.categories || tidied.tags || tidied.index)
    ) return writeJson(oldUpdate ?? {
        global: 0,
        info: [{version: 0}]
    })
    pushUpdateToInfo(newInfo, tidied)
    const result = mergeUpdateWithOld(newInfo, oldUpdate, tidied)
    return writeJson(result)
}

const mergeUpdateWithOld = (newInfo, oldUpdate, tidied) => {
    const result = {
        global: (oldUpdate?.global ?? 0) + (tidied.updateGlobal ? 1 : 0),
        info: [newInfo]
    }
    const charLimit = pluginConfig.charLimit ?? 1024
    if (JSON.stringify(result).length > charLimit) {
        return {
            global: result.global,
            info: [{version: newInfo.version}]
        }
    }
    if (!oldUpdate) return result
    for (let it of oldUpdate.info) {
        if (it.change) it.change = zipInfo(newInfo, it)
        result.info.push(it)
        if (JSON.stringify(result).length > charLimit) {
            result.info.pop()
            break
        }
    }
    return result
}

// 压缩相同项目
const zipInfo = (newInfo, oldInfo) => {
    oldInfo = oldInfo.change
    newInfo = newInfo.change
    const result = []
    for (let i = oldInfo.length - 1; i !== -1; --i) {
        const value = oldInfo[i]
        if (value.flag === 'page' && newInfo.find(it => it.flag === 'html')) continue
        const newValue = newInfo.find(it => it.flag === value.flag)
        if (!newValue) {
            result.push(value)
            continue
        }
        if (!value.value) continue
        const isArray = Array.isArray(newValue.value)
        if (Array.isArray(value.value)) {
            const array = value.value
                .filter(it => isArray ? !newValue.value.find(that => that === it) : it !== newValue.value)
            if (array.length === 0) continue
            result.push({flag: value.flag, value: array.length === 1 ? array[0] : array})
        } else if (isArray) {
            if (!newValue.value.find(it => it === value.value))
                result.push(value)
        } else {
            if (newValue.value !== value.value)
                result.push(value)
        }
    }
    return result.length === 0 ? undefined : result
}

// 将更新推送到 info
const pushUpdateToInfo = (info, tidied) => {
    // 推送页面更新
    if (tidied.page.size > (pluginConfig.maxHtml ?? 15)) {
        // 如果 html 数量超过阈值就直接清掉所有 html
        info.change.push({flag: 'html'})
    } else {
        const pages = []        // 独立更新
        const merges = []       // 要合并的更新
        tidied.page.forEach(it => pages.push(it))
        if (tidied.tags) merges.push(config.tag_dir)
        if (tidied.archives) merges.push(config.archive_dir)
        if (tidied.categories) merges.push(config.category_dir)
        if (tidied.index) {
            pages.push(clipPageName(root, false))
            merges.push('page')
        }
        if (merges.length > 0)
            info.change.push({flag: 'str', value: merges.map(it => `/${it}/`)})
        if (pages.length > 0)
            info.change.push({flag: 'page', value: pages})
    }
    // 推送文件更新
    if (tidied.file.size > 0) {
        const list = []
        tidied.file.forEach(it => list.push(it))
        info.change.push({flag: 'file', value: list})
    }
}

// 将 diff 整理分类，并将 expand 整合到
const tidyDiff = (dif, expand) => {
    const tidied = {
        /** 所有 HTML 页面 */
        page: new Set(),
        /** 所有文件 */
        file: new Set(),
        /** 标记 tags 是否更新 */
        tags: false,
        /** 标记 archives 是否更新 */
        archives: false,
        /** 标记 categories 是否更新 */
        categories: false,
        /** 标记 index 是否更新 */
        index: false,
        /** 标记是否更新 global 版本号 */
        updateGlobal: expand?.global
    }
    const mode = pluginConfig.precisionMode
    for (let it of dif) {
        const url = new URL(nodePath.join(root, it))  // 当前文件的 URL
        const cache = findCache(url)    // 查询缓存
        if (!cache) {
            logger.error(`[buildUpdate] 指定 URL(${url.pathname}) 未查询到缓存规则！`)
            continue
        }
        if (!cache.clean) tidied.updateGlobal = true
        if (it.match(/(\/|\.html)$/)) { // 判断缓存是否是 html
            if (isMerge(it, tidied)) continue
            if (mode.html ?? false) tidied.page.add(url.pathname)
            else tidied.page.add(clipPageName(url.href, !it.endsWith('/')))
        } else {
            const extendedName = (it.includes('.') ? it.match(/[^.]+$/)[0] : null) ?? 'default'
            const setting = mode[extendedName] ?? (mode.default ?? false)
            if (setting) tidied.file.add(url.pathname)
            else {
                let name = url.href.match(/[^/]+$/)[0]
                if (!name) throw `${url.href} 格式错误`
                tidied.file.add(name)
            }
        }
    }
    return tidied
}

function findCache(url) {
    url = new URL(replaceRequest(url.href))
    for (let key in cacheList) {
        const value = cacheList[key]
        if (value.match(url)) return value
    }
    return null
}

function replaceRequest(url) {
    if (!modifyRequest) return url
    const request = new Request(url)
    const newRequest = modifyRequest(request)
    return newRequest?.url ?? url
}

function replaceDevRequest(url) {
    const external = pluginConfig.external
    if (!external?.enable || !external.replace) return url
    for (let value of external.replace) {
        for (let source of value.source) {
            if (url.match(source)) {
                url = url.replace(source, value.dist)
            }
        }
    }
    return url
}

/** 对 hexo 的全局变量进行排序，以保证每次生成的结果一致 */
(() => {
    const locals = hexo.locals
    const compare = (a, b) => a < b ? -1 : 1
    const sort = (name, value) => locals.get(name).data.sort((a, b) => compare(a[value], b[value]))
    const list = {
        posts: 'title',
        pages: 'title',
        tags: 'name',
        categories: 'name'
    }
    for (let key in list) sort(key, list[key])
    locals.get('posts').forEach(it => {
        it.tags.data.sort((a, b) => compare(a.name, b.name))
        it.categories.data.sort((a, b) => compare(a.name, b.name))
    })
})()