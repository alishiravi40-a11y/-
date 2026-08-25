/**
 * SMS Provider Registry
 * Maintains the collection of registered SMS Provider Gateway adapters.
 */

import { ISmsProvider } from './provider.interface';
import { MockSmsProvider } from './mockProvider';
import { KavenegarSmsProvider } from './kavenegarProvider';
import { FarazSmsProvider } from './farazSmsProvider';
import { GhasedakSmsProvider } from './ghasedakProvider';

export class SmsProviderRegistry {
  private providers: Map<string, ISmsProvider> = new Map();

  constructor(autoRegisterDefaults: boolean = true) {
    if (autoRegisterDefaults) {
      this.registerDefaultProviders();
    }
  }

  private registerDefaultProviders() {
    const mock = new MockSmsProvider();
    const kavenegar = new KavenegarSmsProvider();
    const faraz = new FarazSmsProvider();
    const ghasedak = new GhasedakSmsProvider();

    this.registerProvider(mock);
    this.registerProvider(kavenegar);
    this.registerProvider(faraz);
    this.registerProvider(ghasedak);
  }

  /**
   * Register or replace a provider in the registry
   */
  registerProvider(provider: ISmsProvider): void {
    const info = provider.getProviderInfo();
    this.providers.set(info.id, provider);
  }

  /**
   * Unregister a provider by ID
   */
  unregisterProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  /**
   * Get provider instance by ID
   */
  getProvider(id: string): ISmsProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ISmsProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get the default fallback mock provider
   */
  getDefaultMockProvider(): ISmsProvider {
    const mock = this.getProvider('mock_provider_01');
    if (mock) return mock;

    const newMock = new MockSmsProvider();
    this.registerProvider(newMock);
    return newMock;
  }
}

// Global Singleton Registry
export const globalSmsProviderRegistry = new SmsProviderRegistry(true);
