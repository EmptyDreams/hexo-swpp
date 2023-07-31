module.exports = (hexo, hexoConfig, rules, ejectValues) => {
    const {
        modifyRequest,
        fetchNoCache,
        getCdnList,
        getSpareUrls,
        blockRequest,
        config
    } = rules
    const { getSource } = require('./utils')
    const nodePath = require('path')
    const fs = require('fs')

    const root = hexoConfig.url + (hexoConfig.root ?? '/')
    const serviceWorkerConfig = config.serviceWorker

    // noinspection JSUnresolvedVariable
    hexo.extend.generator.register('buildSw', () => {
        if (!serviceWorkerConfig) return
        const absPath = module.path + '/sw-template.js'
        const rootPath = nodePath.resolve('./')
        const relativePath = nodePath.relative(rootPath, absPath)
        // 获取拓展文件
        let cache = getSource(rules, '\n\n', [
            'cacheList', 'modifyRequest', 'getCdnList', 'getSpareUrls', 'blockRequest',
            ...('external' in rules && Array.isArray(rules.external) ? rules.external : [])
        ])
        if (!fetchNoCache) {
            // noinspection JSUnresolvedVariable
            if (getCdnList) {
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
                if (getSpareUrls) {
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
                                                clearTimeout(controllers[i].id)
                                            }
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
        const keyword = "const { cacheList, fetchFile, getSpareUrls } = require('../sw-rules')"
        // noinspection JSUnresolvedVariable
        let swContent = fs.readFileSync(relativePath, 'utf8')
            .replaceAll("// [insertion site] values", ejectValues ?? '')
            .replaceAll(keyword, cache)
            .replaceAll("'@$$[escape]'", (serviceWorkerConfig.escape).toString())
            .replaceAll("'@$$[cacheName]'", `'${serviceWorkerConfig.cacheName}'`)
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
        if (serviceWorkerConfig.debug) {
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
    const registerConfig = config.register
    if (registerConfig) {
        // noinspection JSUnresolvedVariable
        hexo.extend.injector.register('head_begin', () => registerConfig.builder(root, hexoConfig, config), "default")
    }

    // 插入 sw-dom.js
    const domConfig = config.dom
    if (domConfig) {
        // noinspection JSUnresolvedVariable,HtmlUnknownTarget
        hexo.extend.injector.register('body_begin', () => `<script src="/sw-dom.js"></script>`)
        // noinspection JSUnresolvedVariable
        hexo.extend.generator.register('buildDomJs', () => {
            const absPath = module.path + '/sw-dom.js'
            const rootPath = nodePath.resolve('./')
            const relativePath = nodePath.relative(rootPath, absPath)
            const template = fs.readFileSync(relativePath, 'utf-8')
                .replaceAll('// ${onSuccess}', domConfig.onsuccess)
            return {
                path: 'sw-dom.js',
                data: template
            }
        })
    }
}