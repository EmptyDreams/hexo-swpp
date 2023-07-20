// noinspection JSUnresolvedVariable

"use strict"

const config = hexo.config
const pluginConfig = config.swpp || hexo.theme.config

if (pluginConfig?.enable) {
    const rules = loadRules()
    // 排序
    require('./lib/sort.js')(pluginConfig)
    // 生成 update.json
    require('./lib/jsonBuilder.js')(hexo, config, pluginConfig, rules)
    // 生成 sw.js
    require('./lib/swBuilder.js')(hexo, config, pluginConfig, rules)
}

// 加载 sw-rules.js 文件
function loadRules() {
    const logger = require('hexo-log')()
    const nodePath = require('path')
    const fs = require('fs')
    const themeName = hexo.config.theme
    // 根目录下的文件
    const root = nodePath.resolve('./', 'sw-rules.js')
    // themes 文件夹下的文件
    const themes = nodePath.resolve('./themes/', themeName, 'sw-rules.js')
    // node_modules 文件下的文件
    const modules = nodePath.resolve('./node_modules/', `hexo-theme-${themeName}/sw-rules.js`)
    console.log(root)
    console.log(themes)
    console.log(modules)
    const exists = {
        root: fs.existsSync(root),
        themes: fs.existsSync(themes),
        modules: fs.existsSync(modules)
    }
    if (!(exists.root || exists.themes || exists.modules)) {
        const tip = "未找到 sw-rules.js 文件"
        logger.error(tip)
        throw tip
    }
    let result = {}
    if (exists.themes)
        result = require(themes)
    else if (exists.modules) {
        result = require(modules)
    }
    return exists.root ? { ...result, ...require(root) } : result
}