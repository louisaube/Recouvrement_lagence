import { Injectable } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { RequestMethod } from '@nestjs/common'
import { ACCESS_KEY, AccessDeclaration, PUBLIC_KEY } from './access.decorators'

export interface CatalogRoute {
  method: string
  /** Express style: `/users/:id`. */
  path: string
  controller: string
  handlerName: string
  controllerType: Function
  handler: Function
  public: boolean
  access?: AccessDeclaration
  /** `@UseGuards(...)` on the handler or the controller: a business guard narrows access further. */
  customGuards: string[]
}

const GUARDS_METADATA = '__guards__'

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
}

const joinPath = (...parts: string[]): string => {
  const joined = parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')
  return `/${joined}`
}

/** Enumerates the routes declared by the controllers of the application, with their access declaration. */
@Injectable()
export class RouteCatalog {
  private readonly reflector = new Reflector()

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  list(): CatalogRoute[] {
    const routes: CatalogRoute[] = []
    for (const wrapper of this.discovery.getControllers()) {
      const { metatype, instance } = wrapper
      if (!metatype || !instance) continue
      const prefix = (Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined) ?? ''
      const controllerGuards = this.guardNames(Reflect.getMetadata(GUARDS_METADATA, metatype))
      for (const name of this.scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
        const handler = (instance as Record<string, Function>)[name]
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
        if (method === undefined) continue
        const paths = (Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined) ?? ''
        const subPath = Array.isArray(paths) ? paths[0] : paths
        const base = Array.isArray(prefix) ? prefix[0] : prefix
        routes.push({
          method: METHOD_NAMES[method] ?? 'GET',
          path: joinPath(base, subPath),
          controller: metatype.name,
          handlerName: name,
          controllerType: metatype,
          handler,
          public: this.reflector.get<boolean>(PUBLIC_KEY, handler) === true,
          access: this.reflector.get<AccessDeclaration | undefined>(ACCESS_KEY, handler),
          customGuards: [...controllerGuards, ...this.guardNames(Reflect.getMetadata(GUARDS_METADATA, handler))],
        })
      }
    }
    return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  }

  private guardNames(guards: unknown): string[] {
    if (!Array.isArray(guards)) return []
    return guards.map((guard) => (typeof guard === 'function' ? guard.name : String(guard)))
  }
}
