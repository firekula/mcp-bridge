/**
 * @author zhangxin
 * @description creator编辑器头文件
 * 2020/9/4
 */
/**@class AssetDB */
declare namespace Editor {
    /**@see API for main process https://docs.cocos.com/creator/manual/zh/extension/api/asset-db/asset-db-main.html 
     * @see API for renderer process https://docs.cocos.com/creator/manual/zh/extension/api/asset-db/asset-db-renderer.html
     * @see API all https://docs.cocos.com/creator/api/zh/editor/asset-db.html
    */
    declare class AssetDB{
        remote?: AssetDB;
        urlToUuid(url: string) : string
        fspathToUuid(fspath: string) : string
        uuidToFspath(uuid: string) : string
        uuidToUrl(uuid: string) : string
        fspathToUrl(fspath: string) : string
        urlToFspath(url: string) : string
        exists(url: string) : string
        existsByUuid(uuid: string) : string
        existsByPath(fspath: string) : string
        isSubAsset(url: string) : boolean
        isSubAssetByUuid(uuid: string) : boolean
        isSubAssetByPath(fspath: string) : boolean
        containsSubAssets(url: string) : boolean
        containsSubAssetsByUuid(uuid: string) : boolean
        containsSubAssetsByPath(path: string) : boolean
        assetInfo(url: string) : any
        assetInfoByUuid(uuid: string) : any
        assetInfoByPath(fspath: string) : any
        subAssetInfos(url: string) : any[]
        subAssetInfosByUuid(uuid: string) : any[]
        subAssetInfosByPath(fspath: string) : any[]
        loadMeta(url: string) : any
        loadMetaByUuid(uuid: string) : any
        loadMetaByPath(fspath: string) : any
        isMount(url: string) : boolean
        isMountByPath(fspath: string) : boolean
        isMountByUuid(uuid: string) : boolean
        mountInfo(url: string) : any
        mountInfoByUuid(uuid: string) : any
        mountInfoByPath(fspath: string) : any
        mount(path: string, mountPath: string, opts: any, cb?: Function): void
        attachMountPath(mountPath: string, cb?: Function): void
        unattachMountPath(mountPath: string, cb?: Function): void
        unmount(mountPath: string, cb?: Function): void
        
        init(cb?: Function): void
        refresh(url: string, cb?: Function): void
        deepQuery(cb?: Function): void
        queryAssets(pattern: string, assetTypes: string|string[], cb?: Function): void
        queryMetas(pattern: string, type: string, cb?: Function): void
        move(srcUrl: string, destUrl: string, cb?: Function): void
        delete(urls: string[], cb?: Function): void
        create(url: string, data: any, cb?: Function): void
        saveExists(url: string, data: any, cb?: Function): void
        import(rawfiles: string[], url: string, cb?: Function): void
        saveMeta(uuid: string, jsonString: string, cb?: Function): void
        exchangeUuid(urlA: string, urlB: string, cb?: Function): void
        clearImports(url: string, cb?: Function): void
        register(extname: string, folder: string, metaCtor: any): void
        unregister(metaCtor: any): void
        getRelativePath(fspath: string) : string
        getAssetBackupPath(filePath: string): string
        setEventCallback(cb: Function): void
        static runDBWatch(state?: string): void
        queryInfoByUrl(url: string, cb?: Function): void
        queryInfoByUuid(uuid: string, cb?: Function): void
        
    }
    
    export const assetdb: AssetDB;
}
