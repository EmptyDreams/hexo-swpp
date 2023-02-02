// noinspection JSIgnoredPromiseFromCall

(() => {
    /** 缓存库名称 */
    const CACHE_NAME = '@$$[cacheName]'
    /** 控制信息存储地址（必须以`/`结尾） */
    const CTRL_PATH = 'https://id.v3/'

    self.addEventListener('install', () => self.skipWaiting())

    // noinspection JSFileReferences
    const { cacheList, fetchFile, getSpareUrls } = require('../sw-rules')

    // 检查请求是否成功
    // noinspection JSUnusedLocalSymbols
    const checkResponse = response => response.ok || [301, 302, 307].includes(response.status)

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
                return url !== CTRL_PATH && list.match(url) ? (cache.delete(it), url) : null
            })
        )).then(list => list.filter(it => it))
    )

    self.addEventListener('fetch', event => {
        let request = event.request
        if (request.method !== 'GET') return
        // [modifyRequest call]
        const url = new URL(request.url)
        // [blockRequest call]
        if (findCache(url)) {
            const key = `${url.protocol}//${url.host}${url.pathname}`
            event.respondWith(caches.match(key).then(cache =>
                cache ? cache : fetchFile(request, true).then(response => {
                    if (response.status === 200) {
                        const clone = response.clone()
                        caches.open(CACHE_NAME).then(it => it.put(key, clone))
                    }
                    return response
                })
            ))
        } else {
            const spare = getSpareUrls(request.url)
            if (spare) event.respondWith(fetchFile(request, false, spare))
            // [modifyRequest else-if]
        }
    })

    self.addEventListener('message', event => {
        if (event.data === 'update') {
            updateJson().then(info =>
                // noinspection JSUnresolvedVariable
                event.source.postMessage({
                    type: 'update',
                    update: info.list,
                    version: info.version,
                })
            )
        }
    })

    /** 判断指定url击中了哪一种缓存，都没有击中则返回null */
    function findCache(url) {
        if (url.host === 'localhost') return
        for (let key in cacheList) {
            const value = cacheList[key]
            if (value.match(url)) return value
        }
    }

    /**
     * 根据JSON删除缓存
     * @returns {Promise<{version, list}>}
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
            /** 控制信息读写操作 */
            const dbVersion = {
                write: (id) => caches.open(CACHE_NAME)
                    .then(cache => cache.put(CTRL_PATH, new Response(JSON.stringify(id)))),
                read: () => caches.match(CTRL_PATH).then(response => response?.json())
            }
            let list = new VersionList()
            return dbVersion.read().then(oldVersion => {
                const {info, global} = json
                const escape = '@$$[escape]'
                const newVersion = {global, local: info[0].version, escape}
                //新用户不进行更新操作
                if (!oldVersion) {
                    dbVersion.write(newVersion)
                    return newVersion
                }
                // noinspection JSIncompatibleTypesComparison
                let refresh =
                    escape !== 0 && escape !== oldVersion.escape ? true : parseChange(list, info, oldVersion.local)
                dbVersion.write(newVersion)
                //如果需要清理全站
                if (refresh) {
                    if (global === oldVersion.global)
                        list.clean(new CacheChangeExpression({'flag': 'all'}))
                    else list.refresh = true
                }
                return {list: list, version: newVersion}
            })
        }
        return fetchFile(new Request('/update.json'), false)
            .then(response => {
                if (checkResponse(response))
                    return response.json().then(json =>
                        parseJson(json).then(result =>
                            result.list ? deleteCache(result.list).then(list => {
                                return {list, version: result.version}
                            }) : {version: result}
                        )
                    )
                else throw `加载 update.json 时遇到异常，状态码：${response.status}`
            })
    }

    /**
     * 版本列表
     * @constructor
     */
    function VersionList() {

        const list = []
        const refresh = false

        /**
         * 推送一个表达式
         * @param element {CacheChangeExpression} 要推送的表达式
         */
        this.push = element => {
            list.push(element)
        }

        /**
         * 清除列表，并将指定元素推入列表中
         * @param element {CacheChangeExpression} 要推入的元素，留空表示不推入
         */
        this.clean = element => {
            list.length = 0
            if (!element) this.push(element)
        }

        /**
         * 判断指定 URL 是否和某一条规则匹配
         * @param url {string} URL
         * @return {boolean}
         */
        this.match = url => {
            if (refresh) return true
            else {
                for (let it of list) {
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
                this.match = url => url.match(/\/(index\.html)?$/)
                break
            case 'page':
                this.match = url => forEachValues(
                    value => url.match(new RegExp(`\\/${value}\\/(index\\.html)?$`))
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