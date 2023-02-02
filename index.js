// noinspection JSUnresolvedVariable

"use strict"

const config = hexo.config
const pluginConfig = config.swpp || hexo.theme.config

if (pluginConfig?.enable) {
    const nodePath = require('path')
    const rules = require(nodePath.resolve('./', 'sw-rules'))

    // 排序
    require('/lib/sort')(pluginConfig)
    // 生成 update.json
    require('/lib/json')(config, pluginConfig, rules)
    // 生成 sw.js
    require('/lib/sw')(config, pluginConfig, rules)
}