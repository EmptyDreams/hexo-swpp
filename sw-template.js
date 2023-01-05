// noinspection JSIgnoredPromiseFromCall

(() => {
    /** 缓存库名称 */
    const CACHE_NAME = 'kmarBlogCache'
    /** 版本名称存储地址（必须以`/`结尾） */
    const VERSION_PATH = 'https://id.v3/'

    self.addEventListener('install', () => self.skipWaiting())

    // noinspection JSFileReferences
    const { cacheList, replaceList } = require('../sw-cache')

    /**
     * 删除指定缓存
     * @param list 要删除的缓存列表
     * @return {Promise<Array<string>>} 删除的缓存的URL列表
     */
    const deleteCache = list => caches.open(CACHE_NAME).then(cache => cache.keys()
        .then(keys => Promise.all(
            keys.map(async it => {
                const url = it.url
                // noinspection ES6MissingAwait,CommaExpressionJS
                return url !== VERSION_PATH && list.match(url) ? (cache.delete(it), url) : null
            })
        ))
    )

    self.addEventListener('fetch', event => {
        const request = event.request
        if (request.method !== 'GET') return
        const replace = replaceRequest(request)
        const url = new URL(request.url)
        if (findCache(url)) {
            event.respondWith(new Promise(async resolve => {
                const key = `${url.protocol}//${url.host}${url.pathname}`
                let response = await caches.match(key)
                if (!response) {
                    response = await fetchNoCache(request)
                    const status = response.status
                    if ((status > 199 && status < 400) || status === 0) {
                        const clone = response.clone()
                        caches.open(CACHE_NAME).then(cache => cache.put(key, clone))
                    }
                }
                resolve(response)
            }))
        } else if (replace) {
            event.respondWith(fetch(request))
        }
    })

    self.addEventListener('message', event => {
        if (event.data === 'update') {
            updateJson().then(info => {
                // noinspection JSUnresolvedVariable
                event.source.postMessage({
                    type: 'update',
                    update: info.update,
                    version: info.version,
                })
            })
        }
    })

    /** 忽略浏览器HTTP缓存的请求指定request */
    const fetchNoCache = request => fetch(request, {cache: "no-store"})

    /** 判断指定url击中了哪一种缓存，都没有击中则返回null */
    function findCache(url) {
        for (let key in cacheList) {
            const value = cacheList[key]
            if (value.match(url)) return value
        }
        return null
    }

    /**
     * 检查连接是否需要重定向至另外的链接，如果需要则返回新的Request，否则返回null<br/>
     * 该函数会顺序匹配{@link replaceList}中的所有项目，即使已经有可用的替换项<br/>
     * 故该函数允许重复替换，例如：<br/>
     * 如果第一个匹配项把链接由"http://abc.com/"改为了"https://abc.com/"<br/>
     * 此时第二个匹配项可以以此为基础继续进行修改，替换为"https://abc.net/"<br/>
     * @return {boolean} 是否进行了替换
     */
    function replaceRequest(request) {
        let flag = false
        for (let key in replaceList) {
            const value = replaceList[key]
            for (let source of value.source) {
                if (request.url.match(source)) {
                    // noinspection JSUnresolvedVariable
                    request.url = request.url.replace(source, value.dist)
                    flag = true
                }
            }
        }
        return flag
    }

    /**
     * 根据JSON删除缓存
     * @returns {Promise<boolean>} 返回值用于标记当前页是否被刷新
     */
    function updateJson() {
        /**
         * 解析elements，并把结果输出到list中
         * @return boolean 是否刷新全站缓存
         */
        const parseChange = (list, elements, ver) => {
            for (let element of elements) {
                const {version, change} = element
                if (version === ver) return false
                if (change) {
                    for (let it of change)
                        list.push(new CacheChangeExpression(it))
                }
            }
            // 跨版本幅度过大，直接清理全站
            return true
        }
        /** 解析字符串 */
        const parseJson = json => {
            /** 版本号读写操作 */
            const dbVersion = {
                write: (id) => caches.open(CACHE_NAME)
                    .then(cache => cache.put(VERSION_PATH, new Response(id))),
                read: () => caches.match(VERSION_PATH).then(response => response?.json())
            }
            let list = new VersionList()
            return dbVersion.read().then(oldVersion => {
                const {info, global} = json
                const escape = '@$$[escape]'
                const newVersion = {global: global, local: info[0].version, escape: escape}
                //新用户不进行更新操作
                if (!oldVersion) {
                    dbVersion.write(JSON.stringify(newVersion))
                    return newVersion
                }
                // noinspection JSIncompatibleTypesComparison
                let refresh =
                    escape !== 0 && escape !== oldVersion.escape ? true : parseChange(list, info, oldVersion.local)
                dbVersion.write(JSON.stringify(newVersion))
                //如果需要清理全站
                if (refresh) {
                    if (global === oldVersion.global) {
                        list._list.length = 0
                        list.push(new CacheChangeExpression({'flag': 'all'}))
                    } else list.refresh = true
                }
                return {list: list, version: newVersion}
            })
        }
        return fetchNoCache(`/update.json`)
            .then(response => {
                if (response.ok || response.status === 301 || response.status === 302)
                    return response.json().then(json =>
                        parseJson(json).then(result => result.list ?
                            deleteCache(result.list).then(list => {
                                return {
                                    update: list.filter(it => it),
                                    version: result.version
                                }
                            }) : {version: result}
                        )
                    )
                else throw `加载 update.json 时遇到异常，状态码：${response.status}`
            })
    }

    /** 版本列表 */
    class VersionList {

        _list = []
        refresh = false

        push(element) {
            this._list.push(element)
        }

        clean(element = null) {
            this._list.length = 0
            if (!element) this.push(element)
        }

        match(url) {
            if (this.refresh) return true
            else {
                for (let it of this._list) {
                    if (it.match(url)) return true
                }
            }
            return false
        }

    }

    /**
     * 缓存更新匹配规则表达式
     * @param json 格式{"flag": ..., "value": ...}
     * @see https://kmar.top/posts/bcfe8408/#8dbec4f0
     * @constructor
     */
    function CacheChangeExpression(json) {
        const checkCache = url => {
            const cache = findCache(new URL(url))
            return !cache || cache.clean
        }
        /**
         * 遍历所有value
         * @param action {function(string): boolean} 接受value并返回bool的函数
         * @return {boolean} 如果value只有一个则返回`action(value)`，否则返回所有运算的或运算（带短路）
         */
        const forEachValues = action => {
            const value = json.value
            if (Array.isArray(value)) {
                for (let it of value) {
                    if (action(it)) return true
                }
                return false
            } else return action(value)
        }
        switch (json['flag']) {
            case 'all':
                this.match = checkCache
                break
            case 'html':
                this.match = url => url.match(/(\/|\/index\.html)$/)
                break
            case 'page':
                this.match = url => forEachValues(
                    value => url.endsWith(`/${value}/`) || url.endsWith(`/${value}/index.html`)
                )
                break
            case 'file':
                this.match = url => forEachValues(value => url.endsWith(value))
                break
            case 'str':
                this.match = url => forEachValues(value => url.includes(value))
                break
            case 'reg':
                this.match = url => forEachValues(value => url.match(new RegExp(value, 'i')))
                break
            default: throw `未知表达式：${JSON.stringify(json)}`
        }
    }
})()