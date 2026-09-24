/**
 * Session service — holds GDT connector + auth state in RAM
 */

import type { GdtConnector, LiveConnectorOptions } from '../gdt/connector.js';
import { createConnector } from '../gdt/connector.js';
import type {
  CaptchaChallenge,
  ConnectorMode,
  LoginInput,
  LoginResult,
} from '../../shared/models/index.js';

export class SessionService {
  private connector: GdtConnector;
  private mode: ConnectorMode;

  constructor(
    mode: ConnectorMode = 'mock',
    liveOptions: LiveConnectorOptions = {},
    private readonly factory: typeof createConnector = createConnector
  ) {
    this.mode = mode;
    this.connector = factory(mode, liveOptions);
  }

  getConnector(): GdtConnector {
    return this.connector;
  }

  getMode() {
    return this.mode;
  }

  async setMode(mode: ConnectorMode, liveOptions: LiveConnectorOptions = {}) {
    await this.connector.logout();
    this.mode = mode;
    this.connector = this.factory(mode, liveOptions);
  }

  isAuthenticated(): boolean {
    return this.connector.isAuthenticated();
  }

  getSessionInfo() {
    return this.connector.getSessionInfo();
  }

  async startSession(): Promise<CaptchaChallenge> {
    return this.connector.startSession();
  }

  async login(input: LoginInput): Promise<LoginResult> {
    return this.connector.login(input);
  }

  async logout(): Promise<void> {
    await this.connector.logout();
  }
}
