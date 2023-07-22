module.exports = (hexo, config, pluginConfig, rules) => {
    const {
        modifyRequest,
        fetchNoCache,
        getCdnList,
        getSpareUrls,
        blockRequest
    } = rules
    const nodePath = require('path')
    const fs = require('fs')
    const logger = require('hexo-log')()

    const root = config.url + (config.root ?? '/')

    // noinspection JSUnresolvedVariable
    hexo.extend.generator.register('buildSw', () => {
        // noinspection JSUnresolvedVariable
        if (pluginConfig.sw.custom) return
        const absPath = module.path + '/sw-template.js'
        const rootPath = nodePath.resolve('./')
        const relativePath = nodePath.relative(rootPath, absPath)
        /**
         * 获取任意对象（symbol 类型除外）的源码
         * @param any {any} 对象
         * @param separator {string} 分隔符
         * @param whiteList {string[]?} 白名单
         * @return {string}
         */
        function getSource(any, separator = '\n', whiteList = null) {
            switch (typeof any) {
                case 'undefined': return `undefined${separator}`
                case 'object': {
                    let result = whiteList ? '' : '{\n'
                    result += Object.getOwnPropertyNames(any)
                        .filter(key => !whiteList || whiteList.includes(key))
                        .map(key => {
                            const value = any[key]
                            return whiteList ? `const ${key} = ${getSource(value, '')}` : `${key}: ${getSource(value, '')}`
                        }).join(whiteList ? '\n' : ',\n')
                    return result + (whiteList ? '' : '\n}') + separator
                }
                case 'string': return `'${any}'${separator}`
                case 'bigint': return `${any.toString()}n${separator}`
                default: return any.toString() + separator
                case 'symbol':
                    logger.error("[sw builder]: 不支持写入 symbol 类型，请从 sw-rules.js 中移除相关内容！")
                    throw '不支持写入 symbol 类型'
            }
        }
        // 获取拓展文件
        let cache = getSource(rules, '\n\n', [
            'cacheList', 'modifyRequest', 'getCdnList', 'getSpareUrls', 'blockRequest',
            ...('external' in rules && Array.isArray(rules.external) ? rules.external : [])
        ])
        if (!fetchNoCache) {
            // noinspection JSUnresolvedVariable
            if (pluginConfig.sw.cdnRacing && getCdnList) {
                cache +=`
                    const fetchFile = (request, banCache) => {
                        const fetchArgs = {
                            cache: banCache ? 'no-store' : 'default',
                            mode: 'cors',
                            credentials: 'same-origin'
                        }
                        const list = getCdnList(request.url)
                        if (!list || !Promise.any) return fetch(request, fetchArgs)
                        const res = list.map(url => new Request(url, request))
                        const controllers = []
                        return Promise.any(res.map(
                            (it, index) => fetch(it, Object.assign(
                                {signal: (controllers[index] = new AbortController()).signal},
                                fetchArgs
                            )).then(response => checkResponse(response) ? {index, response} : Promise.reject())
                        )).then(it => {
                            for (let i in controllers) {
                                if (i != it.index) controllers[i].abort()
                            }
                            return it.response
                        })
                    }
                `
            } else { // noinspection JSUnresolvedVariable
                if (pluginConfig.sw.spareUrl && getSpareUrls) {
                    cache += `
                        const fetchFile = (request, banCache, spare = null) => {
                            const fetchArgs = {
                                cache: banCache ? 'no-store' : 'default',
                                mode: 'cors',
                                credentials: 'same-origin'
                            }
                            if (!spare) spare = getSpareUrls(request.url)
                            if (!spare) return fetch(request, fetchArgs)
                            const list = spare.list
                            const controllers = []
                            let error = 0
                            return new Promise((resolve, reject) => {
                                const pull = () => {
                                    const flag = controllers.length
                                    if (flag === list.length) return
                                    const plusError = () => {
                                        if (++error === list.length) reject(\`请求 \${request.url} 失败\`)
                                        else if (flag + 1 === controllers.length) {
                                            clearTimeout(controllers[flag].id)
                                            pull()
                                        }
                                    }
                                    controllers.push({
                                        ctrl: new AbortController(),
                                        id: setTimeout(pull, spare.timeout)
                                    })
                                    fetch(new Request(list[flag], request), fetchArgs).then(response => {
                                        if (checkResponse(response)) {
                                            for (let i in controllers) {
                                                if (i !== flag) controllers[i].ctrl.abort()
                                            }
                                            clearTimeout(controllers[controllers.length - 1].id)
                                            resolve(response)
                                        } else plusError()
                                    }).catch(plusError)
                                }
                                pull()
                            })
                        }
                    `
                } else cache += `
                        const fetchFile = (request, banCache) => fetch(request, {
                            cache: banCache ? "no-store" : "default",
                            mode: 'cors',
                            credentials: 'same-origin'
                        })
                    `
            }
        }
        if (!getSpareUrls) cache += `\nconst getSpareUrls = _ => {}`
        if ('afterJoin' in rules)
            cache += `(${getSource(rules.afterJoin)})()\n`
        if ('afterTheme' in rules)
            cache += `(${getSource(rules.afterTheme)})()\n`
        const keyword = "const { cacheList, fetchFile, getSpareUrls, afterJoin, afterTheme } = require('../sw-rules')"
        // noinspection JSUnresolvedVariable
        let swContent = fs.readFileSync(relativePath, 'utf8')
            .replaceAll(keyword, cache)
            .replaceAll("'@$$[escape]'", (pluginConfig.sw.escape ?? 0).toString())
            .replaceAll("'@$$[cacheName]'", `'${pluginConfig.sw.cacheName ?? 'kmarBlogCache'}'`)
        if (modifyRequest) {
            swContent = swContent.replaceAll('// [modifyRequest call]', `
                const modify = modifyRequest(request)
                if (modify) request = modify
            `).replaceAll('// [modifyRequest else-if]', `
                else if (modify) event.respondWith(fetch(request))
            `)
        }
        if (blockRequest) {
            swContent = swContent.replace('// [blockRequest call]', `
                if (blockRequest(url))
                    return event.respondWith(new Response(null, {status: 208}))
            `)
        }
        // noinspection JSUnresolvedVariable
        if (pluginConfig.sw.debug) {
            swContent = swContent.replaceAll('// [debug delete]', `
                console.debug(\`delete cache: \${url}\`)
            `).replaceAll('// [debug put]', `
                console.debug(\`put cache: \${key}\`)
            `).replaceAll('// [debug message]', `
                console.debug(\`receive: \${event.data}\`)
            `).replaceAll('// [debug escape]', `
                console.debug(\`escape: \${aid}\`)
            `)
        }
        return {
            path: 'sw.js',
            data: swContent
        }
    })

    // 生成注册 sw 的代码
    // noinspection JSUnresolvedVariable
    hexo.extend.injector.register('head_begin', () =>
        pluginConfig.sw?.register ?? `<script>
            (() => {
                const sw = navigator.serviceWorker
                const error = () => ${pluginConfig.sw.onerror}
                if (!sw?.register('${new URL(root).pathname}sw.js')
                ${pluginConfig.sw?.onsuccess ? '?.then(() => ' + pluginConfig.sw.onsuccess + ')' : ''}
                ?.catch(error)) error()
            })()
        </script>`, "default")

    // 插入 sw-dom.js
    if (!pluginConfig.dom?.custom) {
        // noinspection JSUnresolvedVariable,HtmlUnknownTarget
        hexo.extend.injector.register('body_begin', () => `<script src="/sw-dom.js"></script>`)
        // noinspection JSUnresolvedVariable
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