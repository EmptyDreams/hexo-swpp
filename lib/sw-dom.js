document.addEventListener('DOMContentLoaded', () => {
    /** 检查 SW 是否可用 */
    const checkServiceWorker = () => 'serviceWorker' in navigator && navigator.serviceWorker.controller
    /** 发送信息到 sw */
    const postMessage2SW = type => navigator.serviceWorker.controller.postMessage(type)
    const pjaxUpdate = url => new Promise(resolve => {
        const type = url.endsWith('js') ? 'script' : 'link'
        const name = type.length === 4 ? 'href' : 'src'
        for (let item of document.querySelectorAll(type)) {
            const itUrl = item[name]
            if (url.length > itUrl ? url.endsWith(itUrl) : itUrl.endsWith(url)) {
                const newEle = document.createElement(type)
                const content = item.text || item.textContent || item.innerHTML || ''
                Array.from(item.attributes).forEach(attr => newEle.setAttribute(attr.name, attr.value))
                newEle.appendChild(document.createTextNode(content))
                item.parentNode.replaceChildren(newEle, item)
                return resolve(true)
            }
        }
        resolve(false)
    })
    if (!checkServiceWorker()) return
    if (sessionStorage.getItem('updated')) {
        sessionStorage.removeItem('updated')
        // ${onSuccess}
    } else postMessage2SW('update')
    navigator.serviceWorker.addEventListener('message', event => {
        const data = event.data
        switch (data.type) {
            case 'update':
                const list = data.update
                if (!list) break
                sessionStorage.setItem('updated', '1')
                // noinspection JSUnresolvedVariable,JSUnresolvedFunction
                if (window.Pjax?.isSupported()) {
                    Promise.all(list.map(url => {
                        if (url.endsWith('.js'))
                            return pjaxUpdate(url)
                        if (url.endsWith('.css'))
                            return pjaxUpdate(url)
                        return Promise.resolve()
                    })).then(() => location.reload())
                } else location.reload()
                break
            case 'escape':
                sessionStorage.setItem('updated', '1')
                location.reload()
                break
        }
    })
})