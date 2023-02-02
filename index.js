// noinspection JSUnresolvedVariable

"use strict"

const config = hexo.config
const pluginConfig = config.swpp || hexo.theme.config

if (pluginConfig?.enable) {
    const nodePath = require('path')
    const rules = require(nodePath.resolve('./', 'sw-rules'))

    // 排序
    require('./lib/sort.js')(pluginConfig)
    // 生成 update.json
    require('./lib/jsonBuilder.js')(hexo, config, pluginConfig, rules)
    // 生成 sw.js
    require('./lib/swBuilder.js')(hexo, config, pluginConfig, rules)
}