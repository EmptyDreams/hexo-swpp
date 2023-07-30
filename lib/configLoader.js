// 配置加载器

const logger = require('hexo-log')()

// 加载 sw-rules.js
module.exports.load = hexo => {
    const rules = loadRules(hexo)
    const handle = (obj, def, list) => {
        for (let key in def) {
            const defValue = def[key]
            const value = obj[key]
            switch (typeof value) {
                case 'undefined':
                    obj[key] = defValue
                    break
                case 'object':
                    const defA = Array.isArray(defValue)
                    const objA = Array.isArray(value)
                    if (defA !== objA) {
                        logger.error(`[ConfigLoader] ${list.join('.')} 值与标准值类型不相同！已经使用默认配置项替代。`)
                        obj[key] = defValue
                        break
                    }
                    if (!defA) {
                        list.push(key)
                        handle(value, defValue, list)
                        list.pop()
                    }
                    break
                case 'boolean':
                    break
            }
        }
    }
    if (!('config' in rules)) {
        logger.error("[ConfigLoader] 未在 sw-rules.js 中查询到配置项！")
        throw '配置项缺失！'
    }
    handle(rules.config, defConfig, [])
    return rules
}

// 存储缺省配置
const defConfig = {
    // sw 有关配置项
    serviceWorker: {
        /**
         * 逃生门
         * @type number
         * @see https://kmar.top/posts/73014407/#6c7c33f0
         */
        escape: 0,
        /**
         * 缓存库名称
         * 发布网站后 **切勿修改** 该配置项！
         * @type string
         */
        cacheName: 'kmarBlogCache',
        /**
         * 是否启用调试，启用后会在 sw 中插入一些辅助调试的代码，不建议开启
         * @type boolean
         */
        debug: false
    },
    // 与 SW 注册有关的配置项
    register: {
        /**
         * sw 注册成功时的动作
         * @type ?VoidFunction
         * */
        onsuccess: undefined,
        /**
         * sw 注册失败时的动作
         * @type ?VoidFunction
         */
        onerror: undefined,
        /**
         * 生成注册 SW 的 HTML 代码片段
         * @param root {string} 网页根目录的 URL
         * @param hexoConfig {Object} Hexo 配置项
         * @param pluginConfig {Object} SW 配置项
         * @return {string} 一个 HTML 标签的字符串形式
         */
        builder: (root, hexoConfig, pluginConfig) => {
            const {onerror, onsuccess} = pluginConfig.register
            return `<script>
                (() => {
                    const sw = navigator.serviceWorker
                    const error = ${onerror.toString()}
                    if (!sw?.register('${new URL(root).pathname}sw.js')
                        ${onsuccess ? '?.then(' + onsuccess + ')' : ''}
                        ?.catch(error)
                        ) error()
                })()
            </script>`
        }
    },
    // 与 DOM 端有关的配置项
    dom: {
        /**
         * 版本更新完成后的动作
         * @type VoidFunction
         */
        onsuccess: () => {}
    },
    /**
     * 与插件生成的版本文件相关的配置项
     * 该功能目前无法关闭
     */
    json: {
        /**
         * 更新缓存时允许更新的最大 HTML 页面数量，需要更新的 HTML 文件数量超过这个值后会清除所有 HTML 缓存
         * @type number
         */
        maxHtml: 15,
        /**
         * 版本文件（update.json）字符数量限制，插件将保证版本文件的字符数量不超过该值
         * @type number
         */
        charLimit: 1024,
        /**
         * 文件缓存匹配采取精确模式
         * 关闭时更新缓存时仅匹配文件名称，如 https://kmar.top/simple/a/index.html 仅匹配 /a/index.html
         * 开启后更新缓存时将会匹配完整名称，如 https://kmar.top/simple/a/index.html 将匹配 /simple/a/index.html
         * 两种方式各有优劣，开启后会增加 update.json 的空间占用，但会提升精确度
         * 如果网站内没有多级目录结构，就可以放心大胆的关闭了
         * key 值为文件拓展名，default 用于指代所有未列出的拓展名以及没有拓展名的文件
         */
        precisionMode: {
            default: false
        },
        /**
         * 是否合并指定项目
         * 例如当 tags 为 true 时（假设标签目录为 https://kmar.top/tags/...）
         * 如果标签页存在更新，则直接匹配 https://kmar.top/tags/ 目录下的所有文件
         * **推荐将此项开启**
         */
        merge: {
            index: true,
            tags: true,
            archives: true,
            categories: true,
            /**
             * 这里填写目录名称列表（不带两边的斜杠）
             * @type string[]
             */
            custom: []
        },
        /**
         * 生成版本文件时忽略的文件
         * 注：匹配的时候不附带域名，只有 pathname，匹配的内容一定是博客本地的文件
         * @type RegExp[]
         */
        exclude: [
            /sw\.js$/
        ]
    },
    /**
     * 外部文件更新监听
     * @see https://kmar.top/posts/73014407/#c60b3060
     */
    external: {
        /**
         * 拉取网络文件时的超时时间
         * @type number
         */
        timeout: 1500,
        /**
         * 匹配 JS 代码中的 URL
         * @see https://kmar.top/posts/73014407/#c60b3060
         */
        js: [],
        /**
         * 某些外链只要 URL 不变其内容就一定不会变
         * 可以通过正则表达式排除这些外链的文件内容监控，加快构建速度
         * 注意：当某一个文件被跳过拉取后，这个文件中包含的 URL 也会被跳过
         * @type RegExp[]
         */
        skip: [],
        /**
         * 在构建过程中替换部分链接，该替换结果不会影响文件内容
         * 该设置项是为了应对构建服务器在国外，但是网站内部分缓存资源无法在国外访问导致拉取时超时的问题
         * @type Object[]
         * @see https://kmar.top/posts/73014407/#4ea71e00
         */
        replace: []
    },
    /**
     * 对 Hexo 中的变量进行排序
     * 默认插件对 posts、tags、categories、pages 四个变量进行排序
     * 排序规则为优先按照字符串长度排序，若长度一致按照字典序排序
     */
    sort: {}
}

// 加载 sw-rules.js 文件
const loadRules = hexo => {
    // noinspection JSUnresolvedReference
    const themeName = hexo.config.theme
    // noinspection JSUnresolvedReference
    const rulesFileName = (hexo.config.swpp?.rules ?? hexo.theme.config.swpp?.rules) ?? 'sw-rules'
    const nodePath = require('path')
    const fs = require('fs')
    const rootList = ['./', `./themes/${themeName}/`, `./node_modules/hexo-theme-${themeName}/`]
    const fileNameList = [`${rulesFileName}.cjs`, `${rulesFileName}.js`]

    /** 尝试在指定目录下查询 rules 文件 */
    function findRules(root) {
        for (let name of fileNameList) {
            const path = nodePath.resolve(root, name)
            if (fs.existsSync(path))
                return path
        }
        return null
    }

    const paths = {
        root: fs.existsSync(rootList[0]),
        themes: fs.existsSync(rootList[1]),
        modules: fs.existsSync(rootList[2])
    }
    if (!(paths.root || paths.themes || paths.modules)) {
        const tip = "未找到 sw-rules 文件"
        logger.error(`[sw-rules]: ${tip}`)
        throw tip
    }
    let result = {}
    if (paths.themes)
        result = require(paths.themes)
    else if (paths.modules) {
        result = require(paths.modules)
    }
    if ('afterTheme' in result)
        logger.error("[sw-rules]: 主题目录下的 sw-rules.js 中不应当包含 afterTheme 函数！")
    return paths.root ? { ...result, ...require(paths.root) } : result
}