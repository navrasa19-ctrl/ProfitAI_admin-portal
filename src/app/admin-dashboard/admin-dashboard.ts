import { CommonModule } from '@angular/common';
import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AdminMeResponse, AuthService } from '../services/auth.service';
import { LiveBinanceChart } from '../live-binance-chart/live-binance-chart';

type AdminAppKey = 'BOT' | 'MLM';

type SectionKey =
  | 'Overview'
  | 'Leader Trading'
  | 'Active Trades'
  | 'Followers'
  | 'Execution Monitor'
  | 'Failed Copies'
  | 'Latency Monitor';

// 🎯 NEW: Interface for DB Active Trades
export interface LeaderTrade {
  id: string;
  symbol: string;
  positionSide: 'LONG' | 'SHORT';
  quantity: number;
  executedPrice: number;
  leverage: number;
  stopLoss: number;
  takeProfit: number;
  status: string;
  createdAt: string;
}

interface LeaderTradeLogEntry {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  quantity: string;
  leverage: number;
  status: 'SUCCESS' | 'FAILED';
  message: string;
  latencyMs: number;
  timestamp: string;
}

interface RoadmapPhase {
  phase: string;
  title: string;
  status: 'DONE' | 'IN_PROGRESS' | 'PENDING';
}

// Same AI service contract the user portal's crypto-dashboard already consumes.
interface AiTrade {
  trade_id: number;
  decision: 'LONG' | 'SHORT' | 'HOLD';
  confidence: number;
  risk: string;
  trend: string;
  leverage: number;
  margin_usd: number;
  stop_loss: number;
  take_profit: number;
  summary: string;
}

interface AiResult {
  overall_decision: 'LONG' | 'SHORT' | 'HOLD' | 'MULTI';
  total_trades: number;
  trades: AiTrade[];
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LiveBinanceChart],
  templateUrl: './admin-dashboard.html',
  styleUrl: './admin-dashboard.css',
})
export class AdminDashboard implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  readonly currentAdmin = signal<AdminMeResponse | null>(null);

  // Bot Admin (copy trading) is the only implemented app shell today. MLM Admin
  // gets its own sidebar/nav once the MLM backend (rewards, royalty, leg matching,
  // payments) exists — until then its switcher tab stays visible but disabled.
  readonly adminApps: { key: AdminAppKey; label: string; enabled: boolean }[] = [
    { key: 'BOT', label: 'Bot Admin', enabled: true },
    { key: 'MLM', label: 'MLM Admin', enabled: false },
  ];
  readonly activeApp = signal<AdminAppKey>('BOT');

  readonly activeSection = signal<SectionKey>('Overview');

  readonly mainNav: SectionKey[] = ['Overview'];
  readonly copyTradingNav: SectionKey[] = [
    'Leader Trading',
    'Active Trades',
    'Followers',
    'Execution Monitor',
    'Failed Copies',
    'Latency Monitor',
  ];

  // Client-side only until the emergency-stop backend endpoint (Phase "risk controls") exists.
  readonly systemStopped = signal(false);

  // --- 🎯 NEW: Active Trades Signals ---
  readonly activeTrades = signal<LeaderTrade[]>([]);
  readonly loadingTrades = signal(false);
  readonly editingLimits = signal<string | null>(null);
  readonly editSL = signal<number>(0);
  readonly editTP = signal<number>(0);

  readonly tradeForm = this.formBuilder.nonNullable.group({
    symbol: ['BTCUSDT', Validators.required],
    direction: ['LONG' as 'LONG' | 'SHORT', Validators.required],
    marginUsd: [100, [Validators.required, Validators.min(1)]],
    leverage: [10, [Validators.required, Validators.min(1), Validators.max(125)]],
    entryPrice: [''],
    stopLoss: [''],
    takeProfit: [''],
  });

  // 🎯 NEW: Dynamically calculates BTC size based on Margin, Leverage, and Live Price
  get calculatedBtcQty(): string {
    const margin = this.tradeForm.get('marginUsd')?.value || 0;
    const lev = this.tradeForm.get('leverage')?.value || 1;
    const price = this.livePrice();

    if (!price || price <= 0) return '0.000';
    return ((margin * lev) / price).toFixed(3);
  }

  readonly submitting = signal(false);
  readonly tradeError = signal('');
  readonly tradeLog = signal<LeaderTradeLogEntry[]>([]);

  readonly closeSymbol = signal('BTCUSDT');
  readonly closeDirection = signal<'LONG' | 'SHORT'>('LONG');
  readonly closing = signal(false);
  readonly closeError = signal('');

  // --- AI Autonomous Bot (same /analyze contract as the user portal's crypto-dashboard) ---
  private static readonly AI_ENDPOINT = 'http://187.53.129.115:8000/analyze';
  private static readonly AI_POLL_MS = 180000; 
  private static readonly AI_CONFIDENCE_THRESHOLD = 60;
  private static readonly AI_DEFAULT_MARGIN_USD = 50;

  readonly aiBotEnabled = signal(false);
  readonly aiData = signal<AiResult | null>(null);
  readonly aiError = signal('');
  readonly aiLastCheckedAt = signal('');
  private aiPollHandle?: ReturnType<typeof setInterval>;
  private aiTradeInFlight = false;

  // Standalone price feed so AI sizing works from any section, not just while the chart is mounted.
  private priceWs?: WebSocket;
  readonly livePrice = signal<number | null>(null);

  readonly roadmap: RoadmapPhase[] = [
    { phase: 'Phase 0', title: 'Freeze existing trading, keep admin execution reliable', status: 'DONE' },
    { phase: 'Phase 9', title: 'Admin console shell + live leader chart + leader trade execution', status: 'IN_PROGRESS' },
    { phase: 'Phase 1', title: 'Exchange account ownership & security fix', status: 'PENDING' },
    { phase: 'Phase 2', title: 'ExchangeTradingClient abstraction', status: 'PENDING' },
    { phase: 'Phase 3', title: 'LeaderTrade persistence', status: 'PENDING' },
    { phase: 'Phase 4', title: 'CopyTradingSubscription', status: 'PENDING' },
    { phase: 'Phase 5', title: 'CopyTradeEvent + Outbox', status: 'PENDING' },
    { phase: 'Phase 6', title: 'CopyTradingEngine (parallel execution)', status: 'PENDING' },
    { phase: 'Phase 7', title: 'Close-position propagation', status: 'PENDING' },
    { phase: 'Phase 8', title: 'SL/TP propagation', status: 'PENDING' },
    { phase: 'Phase 10', title: 'User copy-trading UI', status: 'PENDING' },
    { phase: 'Phase 15', title: '100-user load / latency test', status: 'PENDING' },
  ];

  ngOnInit(): void {
    this.authService.getAdminProfile().subscribe({
      next: admin => this.currentAdmin.set(admin),
      error: error => {
        if (error.status === 401 || error.status === 403) this.logout();
      },
    });

    this.connectPriceFeed();
    this.fetchActiveTrades();
    this.loadAiData();
    this.aiPollHandle = setInterval(() => this.loadAiData(), AdminDashboard.AI_POLL_MS);
  }

  ngOnDestroy(): void {
    if (this.aiPollHandle) clearInterval(this.aiPollHandle);
    if (this.priceWs) this.priceWs.close();
  }

  selectSection(section: SectionKey): void {
    this.activeSection.set(section);
    if (section === 'Active Trades') {
      this.fetchActiveTrades();
    }
  }

  selectApp(app: { key: AdminAppKey; enabled: boolean }): void {
    if (!app.enabled) return;
    this.activeApp.set(app.key);
    this.activeSection.set('Overview');
  }

  logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  adminInitial(): string {
    return this.currentAdmin()?.name?.charAt(0).toUpperCase() || 'A';
  }

  toggleEmergencyStop(): void {
    this.systemStopped.set(!this.systemStopped());
  }

  // ==================== 🎯 ACTIVE TRADES LOGIC ====================
  fetchActiveTrades(): void {
    this.loadingTrades.set(true);
    this.http.get<LeaderTrade[]>(`${environment.apiUrl}/trade/active`).subscribe({
      next: (trades) => {
        this.activeTrades.set(trades);
        this.loadingTrades.set(false);
      },
      error: () => this.loadingTrades.set(false)
    });
  }

  getTradePnL(trade: LeaderTrade): number {
    const currentPrice = this.livePrice();
    if (!currentPrice || !trade.executedPrice) return 0;

    const priceDiff = trade.positionSide === 'LONG'
      ? currentPrice - trade.executedPrice
      : trade.executedPrice - currentPrice;

    return priceDiff * trade.quantity;
  }

  closeTrade(tradeId: string): void {
    if (!confirm('Liquidate this leader position?')) return;
    this.http.post(`${environment.apiUrl}/trade/close/${tradeId}`, {}).subscribe({
      next: () => {
        // Remove from UI instantly
        this.activeTrades.set(this.activeTrades().filter(t => t.id !== tradeId));
      },
      error: (err) => alert(err.error?.error || 'Failed to close trade')
    });
  }

  startEditLimits(trade: LeaderTrade): void {
    this.editingLimits.set(trade.id);
    this.editSL.set(trade.stopLoss || 0);
    this.editTP.set(trade.takeProfit || 0);
  }

  saveLimits(tradeId: string): void {
    const payload = {
      tradeId: tradeId,
      stopLoss: this.editSL(),
      takeProfit: this.editTP()
    };

    this.http.post(`${environment.apiUrl}/trade/update-limits`, payload).subscribe({
      next: () => {
        this.activeTrades.update(trades => trades.map(t => {
          if (t.id === tradeId) return { ...t, stopLoss: this.editSL(), takeProfit: this.editTP() };
          return t;
        }));
        this.editingLimits.set(null); // Close edit view
      },
      error: (err) => alert(err.error?.error || 'Failed to update limits')
    });
  }

  cancelEdit(): void {
    this.editingLimits.set(null);
  }

  // Single control that doubles as ON/OFF and emergency stop for the AI bot only —
  // manual leader trading (the form below) is unaffected by this toggle.
  toggleAiBot(): void {
    this.aiBotEnabled.set(!this.aiBotEnabled());
  }

  executeTrade(): void {
    if (this.tradeForm.invalid || this.submitting() || this.systemStopped()) {
      this.tradeForm.markAllAsTouched();
      return;
    }

    const value = this.tradeForm.getRawValue();
    const currentPrice = this.livePrice();

    if (!currentPrice || currentPrice <= 0) {
      this.tradeError.set('Waiting for live price feed to calculate BTC quantity.');
      return;
    }

    // 🎯 NEW: Calculate final BTC quantity to send to backend
    const calculatedQuantity = ((value.marginUsd * value.leverage) / currentPrice).toFixed(3);

    if (Number(calculatedQuantity) <= 0) {
      this.tradeError.set('Calculated BTC quantity is too small. Increase Margin or Leverage.');
      return;
    }

    const body: Record<string, unknown> = {
      symbol: value.symbol.toUpperCase(),
      direction: value.direction,
      quantity: calculatedQuantity, // Send computed BTC to backend
      leverage: value.leverage,
    };

    // Use live price if entry price is left blank
    const finalEntryPrice = value.entryPrice ? value.entryPrice : currentPrice;
    if (finalEntryPrice) body['entryPrice'] = finalEntryPrice;
    if (value.stopLoss) body['stopLoss'] = value.stopLoss;
    if (value.takeProfit) body['takeProfit'] = value.takeProfit;

    this.submitting.set(true);
    this.tradeError.set('');
    const startedAt = performance.now();

    this.http.post<{ binanceResponse: string; tradeId: string }>(`${environment.apiUrl}/trade/execute`, body).subscribe({
      next: response => {
        const latencyMs = Math.round(performance.now() - startedAt);
        this.submitting.set(false);
        this.pushLogEntry({
          id: response.tradeId ?? 'NONE',
          symbol: body['symbol'] as string,
          direction: value.direction as 'LONG' | 'SHORT',
          quantity: calculatedQuantity,
          leverage: value.leverage,
          status: 'SUCCESS',
          message: 'Leader order accepted.',
          latencyMs,
          timestamp: new Date().toLocaleTimeString(),
        });
        this.fetchActiveTrades(); // 🔄 Reload DB table
      },
      error: error => {
        const latencyMs = Math.round(performance.now() - startedAt);
        this.submitting.set(false);
        const message = error.error?.error || 'Leader trade was rejected.';
        this.tradeError.set(message);
        this.pushLogEntry({
          id: '-',
          symbol: body['symbol'] as string,
          direction: value.direction,
          quantity: calculatedQuantity,
          leverage: value.leverage,
          status: 'FAILED',
          message,
          latencyMs,
          timestamp: new Date().toLocaleTimeString(),
        });
      },
    });
  }

  closeAllForDirection(): void {
    if (this.closing()) return;
    this.closing.set(true);
    this.closeError.set('');

    const symbol = this.closeSymbol().toUpperCase();
    const direction = this.closeDirection();

    this.http.post(`${environment.apiUrl}/trade/close-all/${symbol}?direction=${direction}`, {}).subscribe({

      next: () => this.closing.set(false),
      error: error => {
        this.closing.set(false);
        this.closeError.set(error.error?.error || 'Close request failed.');
      },
    });
  }

  private pushLogEntry(entry: LeaderTradeLogEntry): void {
    this.tradeLog.set([entry, ...this.tradeLog()].slice(0, 25));
  }

  // --- AI bot: fetch decision, then (if enabled) execute through the same /trade/execute
  // endpoint the manual form uses, so every AI order lands in the same log/rules/limits. ---

  private loadAiData(): void {
    const headers = new HttpHeaders({ 'X-Frontend-Api-Key': 'navrasa-ai-secure-key-2026' });

    this.http.get<any>(AdminDashboard.AI_ENDPOINT, { headers }).subscribe({
      next: response => {
        let data = response?.ai_result !== undefined ? response.ai_result : response;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data.replace(/```json/g, '').replace(/```/g, '').trim());
          } catch {
            this.aiError.set('Could not parse AI response.');
            return;
          }
        }
        if (data && typeof data === 'object') {
          this.aiData.set(data as AiResult);
          this.aiError.set('');
          this.aiLastCheckedAt.set(new Date().toLocaleTimeString());
          this.maybeExecuteAiTrade(data as AiResult);
        } else {
          this.aiError.set('Invalid AI response structure.');
        }
      },
      error: () => this.aiError.set('Could not reach the AI engine.'),
    });
  }

  private maybeExecuteAiTrade(ai: AiResult): void {
    // Hard gate: AI bot must be ON, emergency stop must be OFF, and nothing else in flight.
    if (!this.aiBotEnabled() || this.systemStopped() || this.aiTradeInFlight || this.submitting()) return;
    if (ai.overall_decision === 'HOLD' || !ai.trades?.length) return;

    const pick = ai.trades.find(t => t.decision !== 'HOLD' && t.confidence >= AdminDashboard.AI_CONFIDENCE_THRESHOLD);
    if (!pick) return;

    const price = this.livePrice();
    if (!price || price <= 0) {
      this.pushLogEntry(this.aiLogEntry(pick, 'FAILED', 'AI bot: waiting for live price feed before sizing the order.'));
      return;
    }

    const margin = pick.margin_usd > 0 ? pick.margin_usd : AdminDashboard.AI_DEFAULT_MARGIN_USD;
    const quantity = ((margin * pick.leverage) / price).toFixed(3);
    if (Number(quantity) <= 0) return;

    const body: Record<string, unknown> = {
      symbol: 'BTCUSDT',
      direction: pick.decision,
      quantity,
      leverage: pick.leverage,
    };
    if (pick.stop_loss && pick.take_profit) {
      body['entryPrice'] = price;
      body['stopLoss'] = pick.stop_loss;
      body['takeProfit'] = pick.take_profit;
    }

    this.aiTradeInFlight = true;
    const startedAt = performance.now();

    this.http.post<{ tradeId: string }>(`${environment.apiUrl}/trade/execute`, body).subscribe({
      next: response => {
        this.aiTradeInFlight = false;
        const latencyMs = Math.round(performance.now() - startedAt);
        this.pushLogEntry({
          id: response.tradeId ?? 'NONE',
          symbol: 'BTCUSDT',
          direction: pick.decision as 'LONG' | 'SHORT',
          quantity,
          leverage: pick.leverage,
          status: 'SUCCESS',
          message: `AI bot (conf ${pick.confidence}%): ${pick.summary || 'signal executed'}`,
          latencyMs,
          timestamp: new Date().toLocaleTimeString(),
        });
      },
      error: error => {
        this.aiTradeInFlight = false;
        const latencyMs = Math.round(performance.now() - startedAt);
        this.pushLogEntry(this.aiLogEntry(pick, 'FAILED', `AI bot: ${error.error?.error || 'execution failed'}`, latencyMs, quantity));
      },
    });
  }

  private aiLogEntry(
    pick: AiTrade,
    status: 'SUCCESS' | 'FAILED',
    message: string,
    latencyMs = 0,
    quantity = '0',
  ): LeaderTradeLogEntry {
    return {
      id: '-',
      symbol: 'BTCUSDT',
      direction: pick.decision as 'LONG' | 'SHORT',
      quantity,
      leverage: pick.leverage,
      status,
      message,
      latencyMs,
      timestamp: new Date().toLocaleTimeString(),
    };
  }

  private connectPriceFeed(): void {
    this.priceWs = new WebSocket('wss://fstream.binancefuture.com/ws/btcusdt@ticker');
    this.priceWs.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.e === '24hrTicker') this.livePrice.set(Number(data.c));
    };
  }
}