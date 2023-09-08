这是 `swpp-backends` 的 hexo 端实现，绝大多数功能由 [swpp-backends](https://github.com/EmptyDreams/swpp-backends) 提供。

## 安装

使用时需要同时安装 `hexo-swpp` 和 `swpp-backends`：

```bash
npm install hexo-swpp swpp-backends
```

当 `swpp-backends` 存在版本更新时，可以直接更新 `swpp-backends` 版本，不需要更新 `hexo-swpp` 的版本。（不过 `hexo-swpp` 有更新的话最好也跟进一下。）

注意：更新 `swpp-backends` 版本时需要注意其版本是否与 `hexo-swpp` 匹配，版本匹配列表如下：

| hexo-swpp 版本 | swpp-backends 版本 |
|:------------:|:----------------:|
|     ~3.0     |      ^1.0.0      |
|     ~3.1     |      ^1.1.0      |
|     ~3.2     |      ^2.0.0      |
|     ~3.3     |      ^2.1.2      |

## 使用

在 hexo 或主题的配置文件中添加如下内容即可启用插件：

```yml
swpp:
  # 是否启用插件
  enable: true
  # 是否在发布前自动执行脚本
  # auto_exec: true
  # 构建时拉取版本文件的警告等级，缺省为 1（该功能仅在 swpp-backends 版本号 >= 2.1.2 时可用）
  # 0 - 表示不允许出现 404 情况；1 - 表示允许服务器返回 404 状态码；2 - 表示允许任何 404（包括 DNS 解析失败等）
  # warn_level: 1
  # 检查版本的 URL，不能以 '/' 结尾
  # npm_url: 'https://registry.npmmirror.com'
```

插件会在生成网站时自动生成 Service Worker、注册代码、DOM 端支持代码（如果功能开启了的话），版本更新文件需要通过 `hexo swpp` 命令手动生成。

`auto_exec` 配置项允许用户在执行 `hexo deploy` 指令时自动执行 `hexo swpp` 的内容（注意开启该配置项后无法再使用 `hexo swpp` 命令）。

⚠ 注意：

+ 如果你的网站启用 `swpp` 后还没有发布过，请勿将 `warn_level` 设置为 0，这会导致构建失败。
+ 尽可能在压缩网站内容前执行 `hexo swpp`，因为部分压缩插件可能会出现同样的内容连续压缩结果不一样的问题，这会导致插件错误地更新缓存。
+ 如果你的网站发布过程不使用 `hexo deploy` 指令，则不要启用 `auto_exec` 选项。
+ 将 `npm_url` 调整为非官方 URL 后检查版本时可能会出现 404 错误。

插件的具体配置见 [Swpp Backends 官方文档 | 山岳库博](https://kmar.top/posts/b70ec88f/)。

### sort

`hexo-swpp` 在规则文件中添加了一个配置项——`sort`，用法如下：

```javascript
module.exports.config = {
    sort: {
        posts: 'title',
        pages: 'title',
        tags: 'name'
    }
}
```

该配置项是为了对 hexo 中的一些变量进行排序，避免每次生成 HTML 时由于这些变量的顺序变动导致生成结果不完全相同。上方代码给出的值为插件的缺省值，用户设置该项不会直接覆盖这些值，只有用户也声明 `posts`、`pages` 或 `tags` 时才会覆盖对应的值。

其中 key 值为要排序的变量的名称，value 为变量排序时的依据，填 `false` 表示禁用该项排序，填 `true` 表示以 value 本身为键进行排序，填字符串表示以 `value[tag]` 为键进行排序。

---

## 更新日志

+ 3.3+
  1. 版本检查改为仅在执行 `hexo server` 时执行 \[3.3.0]
  2. 支持自定义版本更新检查的 URL \[3.3.0]
  3. 修复有时更新代码不执行的问题 \[3.3.1]

+ 3.2+

  1. 支持 `swpp-backends@2` \[3.2.0]
  2. 优化不运行 swpp 时的性能 \[3.2.1]
  3. 支持发布前自动执行 swpp \[3.2.1]
  4. 修复构建时报错的**严重漏洞** \[3.2.2]
  5. 插入的 DOM JS 加载方式改为 async \[3.2.2]
  6. 修复运行 `hexo s` 时报错的问题 \[3.2.3]
  7. 支持版本检查 \[3.2.3]
  8. 版本检查移动到 `generateBefore` 事件中 \[3.2.4]
  9. 支持调整文件拉取的判断等级 \[3.3.0]
  
+ 3.1+

  1. 支持 `swpp-backends@1.1` \[3.1.0]
  2. 修复无法正确读取主题配置文件的问题 \[3.1.1]

+ 3.0+
    
  该版本与 V2 不兼容，请注意修改配置文件！

  相比于 V2，V3 有以下改动：
  1. 移除了配置项中的 `json.precisionMode` 选项
  2. 修改了配置项 `json` 中的 `merge` 和 `exclude` 的写法
  3. 修改了配置项中的 `external.js` 的写法
  4. 将配置项 `external` 中的 `skip` 替换为 `stable`，`replace` 替换为 `replacer`
  5. 规则文件中的 `cacheList` 替换为 `cacheRules`，`getCdnList` 替换为 `getRaceUrls`
  6. 兼容 hexo 7