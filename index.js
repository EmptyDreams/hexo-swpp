// noinspection JSUnresolvedVariable

"use strict"

const config = hexo.config
const enable = (config.swpp ?? hexo.theme.config.swpp)?.enable
const logger = require('hexo-log')()

if (enable) {
    const rules = loadRules()
    const defConfig = require('./lib/defConfig')
    if (!rules.config) {
        logger.error("未在 sw-rules.js 中查找到插件配置！")
        throw '插件配置缺失'
    }
    // 排序
    require('./lib/sort.js')(defConfig, rules.config)
    // 生成 update.json
    require('./lib/jsonBuilder.js')(hexo, config, defConfig, rules)
    // 生成 sw.js
    require('./lib/swBuilder.js')(hexo, config, defConfig, rules)
}

// 加载 sw-rules.js 文件
function loadRules() {
    const nodePath = require('path')
    const fs = require('fs')
    const themeName = hexo.config.theme
    // 根目录下的文件
    const root = nodePath.resolve('./', 'sw-rules.js')
    // themes 文件夹下的文件
    const themes = nodePath.resolve('./themes/', themeName, 'sw-rules.js')
    // node_modules 文件下的文件
    const modules = nodePath.resolve('./node_modules/', `hexo-theme-${themeName}/sw-rules.js`)
    const exists = {
        root: fs.existsSync(root),
        themes: fs.existsSync(themes),
        modules: fs.existsSync(modules)
    }
    if (!(exists.root || exists.themes || exists.modules)) {
        const tip = "未找到 sw-rules.js 文件"
        logger.error(`[sw-rules]: ${tip}`)
        throw tip
    }
    let result = {}
    if (exists.themes)
        result = require(themes)
    else if (exists.modules) {
        result = require(modules)
    }
    if ('afterTheme' in result)
        logger.error("[sw-rules]: 主题目录下的 sw-rules.js 中不应当包含 afterTheme 函数！")
    return exists.root ? { ...result, ...require(root) } : result
}