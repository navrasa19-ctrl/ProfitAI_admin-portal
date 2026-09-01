import { CommonModule, DecimalPipe } from '@angular/common';
import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, signal, NgZone } from '@angular/core';

@Component({
  selector: 'app-live-binance-chart',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './live-binance-chart.html',
  styleUrl: './live-binance-chart.css',
})
export class LiveBinanceChart implements AfterViewInit, OnDestroy {
  @ViewChild('chartContainer', { static: true }) private chartContainer!: ElementRef<HTMLDivElement>;
  private readonly zone = inject(NgZone);

  private binanceWs?: WebSocket;

  // Signals for the header stats strip
  readonly price = signal<number | null>(null);
  readonly priceChangePercent = signal<number>(0);
  readonly highPrice = signal<number>(0);
  readonly lowPrice = signal<number>(0);
  readonly volume = signal<number>(0);

  ngAfterViewInit(): void {
    this.initTradingViewWidget();
    this.connectLiveWebSocket();
  }

  ngOnDestroy(): void {
    if (this.binanceWs) this.binanceWs.close();
  }

  private initTradingViewWidget(): void {
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (typeof (window as any).TradingView !== 'undefined') {
        new (window as any).TradingView.widget({
          "autosize": true,
          "symbol": "BINANCE:BTCUSDTPERP", // Perpetual Futures - this is the leader instrument
          "interval": "15",
          "timezone": "Etc/UTC",
          "theme": "light",
          "style": "1", // Candles
          "locale": "en",
          "enable_publishing": false,
          "backgroundColor": "#ffffff",
          "gridColor": "#eef0f2",
          "hide_top_toolbar": false,
          "hide_legend": false,
          "save_image": false,
          "container_id": this.chartContainer.nativeElement.id,
          "allow_symbol_change": false,
          "calendar": false,
          "studies": [
            "Volume@tv-basicstudies"
          ]
        });
      }
    };
    document.head.appendChild(script);
  }

  private connectLiveWebSocket(): void {
    // binancefuture.com bypasses regional ISP blocks for the raw ticker stream
    this.binanceWs = new WebSocket('wss://fstream.binancefuture.com/ws/btcusdt@ticker');

    this.binanceWs.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.e === '24hrTicker') {
        this.zone.run(() => {
          this.price.set(Number(data.c));
          this.priceChangePercent.set(Number(data.P));
          this.highPrice.set(Number(data.h));
          this.lowPrice.set(Number(data.l));
          this.volume.set(Number(data.v));
        });
      }
    };
  }
}