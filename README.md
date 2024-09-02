这是 `swpp-backends` 的 hexo 端实现，绝大多数功能由 [swpp-backends](https://github.com/EmptyDreams/swpp-backends) 提供。

## 安装

使用时需要同时安装 `hexo-swpp` 和 `swpp-backends`：

```bash
npm install hexo-swpp swpp-backends@3.0.0-alpha.100
```

当 `swpp-backends` 存在版本更新时，可以直接更新 `swpp-backends` 版本，不需要更新 `hexo-swpp` 的版本。（不过 `hexo-swpp` 有更新的话最好也跟进一下。）

注意：更新 `swpp-backends` 版本时需要注意其版本是否与 `hexo-swpp` 匹配，版本匹配列表如下：

| hexo-swpp 版本 | swpp-backends 版本 |
|:------------:|:----------------:|
|     ~3.0     |      ^1.0.0      |
|     ~3.1     |      ^1.1.0      |
|     ~3.2     |      ^2.0.0      |
|     ~3.3     |      ^2.1.2      |
|  4.0-alpha   |   3.0.0-alpha    |

## 使用

在 hexo 或主题的配置文件中添加如下内容即可启用插件：

```yml
swpp:
  # 是否启用，默认 false
  enable: true
  # 配置文件路径，以 `/` 结尾表示加载指定文件夹下的所有文件，注意文件夹中只能有配置文件，不能有其它文件及文件夹
  # config_path: 'swpp.config.ts'
  # 是否生成 sw
  # serviceWorker: true
  # 是否向所有 HTML 插入注册 sw 的代码
  # auto_register: true
  # 是否生成 DOM 端的 JS 文件并在 HTML 中插入 script
  # gen_dom: true
  # 生成的 diff 文件的路径（可以是绝对路径也可以是相对路径，使用相对路径时相对于网站发布目录），留空表示不生成（默认为 null）
  # gen_diff: './diff.json'
  # 是否在执行 hexo deploy 时自动执行 swpp 指令
  # auto_exec: false
  # 检查更新的网址，默认 "https://registry.npmjs.org"，注意不能以斜杠结尾
  # npm_url: 'https://registry.npmmirror.com'
  #
  # 排序规则。
  # 该配置项是为了对 hexo 中的一些变量进行排序，避免每次生成 HTML 时由于这些变量的顺序变动导致生成结果不完全相同。
  # 示例：
  # ```yaml
  # # 下面给出的值为插件的缺省值，用户设置该项不会直接覆盖这些值，只有用户也声明 posts、pages 或 tags 时才会覆盖对应的值。
  # swpp:
  #   sort_rules:
  #     posts: 'title'
  #     pages: 'title'
  #     tags: 'name'
  # ```
  # 其中 key 值为要排序的变量的名称，value 为变量排序时的依据，
  # 填 false 表示禁用该项排序，填 true 表示以 value 本身为键进行排序，填字符串表示以 value[tag] 为键进行排序。
  # sort_rules:
```

插件会在生成网站时自动生成 Service Worker、注册代码、DOM 端支持代码（如果功能开启了的话），版本更新文件需要通过 `hexo swpp` 命令手动生成。

`auto_exec` 配置项允许用户在执行 `hexo deploy` 指令时自动执行 `hexo swpp` 的内容（注意开启该配置项后无法再使用 `hexo swpp` 命令）。

⚠ 注意：

+ 尽可能在压缩网站内容前执行 `hexo swpp`，因为部分压缩插件可能会出现同样的内容连续压缩结果不一样的问题，这会导致插件错误地更新缓存。
+ 如果你的网站发布过程不使用 `hexo deploy` 指令，则不要启用 `auto_exec` 选项。
+ 将 `npm_url` 调整为非官方 URL 后检查版本时可能会出现 404 错误。

SWPP v3 的文档尚未完成，敬请期待。

### 指令

1. `hexo swpp` - 构建 json 文件
2. `hexo swpp -b` / `hexo swpp --build` - 构建 json 文件，同 `hexo swpp`
3. `hexo swpp -t [URL]` / `hexo swpp --test [URL]` - 尝试拉取指定 URL，使用时将 `[URL]` 替换为有效的 HTTP/HTTPS 链接（需要附带协议头）

## 更新日志

+ 4.0+
  1. 适配 `swpp-backends@3`

+ 3.3+
  1. 版本检查改为仅在执行 `hexo server` 时执行 \[3.3.0]
  2. 支持自定义版本更新检查的 URL \[3.3.0]
  3. 修复有时更新代码不执行的问题 \[3.3.1]
  4. 修改 DOM JS 的插入位置（从 body 中移动到 head 中） \[3.3.2]
  5. 修复 hexo7 中无法排序 tags 的问题 \[3.3.3]
  6. 修复 hexo7 中执行 `hexo g` 指令时排序报错的问题 \[3.3.5]
  7. 修复属性的值不支持使用`in`时报错的问题 \[3.3.6]
  8. 添加新的指令 \[3.3.7]
  9. 优化控制台输出 \[3.3.7]

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