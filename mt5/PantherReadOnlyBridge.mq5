// Panther FX read-only MT5 exporter. No order placement or position changes.
#property strict
#property version "1.100"
#property description "Exports XAUUSD.V market snapshots locally; does not trade or send account details."
input string BridgeSymbol="XAUUSD.V";
input int ExportEverySeconds=10;
input int HistoryBars=300;
input bool IncludeAvailableDOM=false;
string OutputName="PantherFX\\vestrado-snapshot.json";
bool domSubscribed=false;
MqlRates CachedAsk;
long CachedAskOpen=0;
bool AskReady=false;
void UpdateAskM5(){
 MqlRates bars[];
 if(CopyRates(BridgeSymbol,PERIOD_M5,1,1,bars)!=1)return;
 long opened=(long)bars[0].time;
 if(AskReady && opened==CachedAskOpen)return;
 AskReady=false;
 MqlTick ticks[];
 int count=CopyTicksRange(BridgeSymbol,ticks,COPY_TICKS_ALL,(ulong)opened*1000,(ulong)(opened+300)*1000-1);
 if(count<=0 || count>200000)return;
 int accepted=0;
 long first=0,last=0;
 for(int i=0;i<count;i++){
  if(ticks[i].ask<=0 || ticks[i].bid<=0 || ticks[i].ask<ticks[i].bid)continue;
  if(accepted==0){CachedAsk.open=ticks[i].ask;CachedAsk.high=ticks[i].ask;CachedAsk.low=ticks[i].ask;first=ticks[i].time;}
  CachedAsk.high=MathMax(CachedAsk.high,ticks[i].ask);
  CachedAsk.low=MathMin(CachedAsk.low,ticks[i].ask);
  CachedAsk.close=ticks[i].ask;last=ticks[i].time;accepted++;
 }
 // Sparse/incomplete terminal history is withheld instead of synthesizing ask OHLC.
 if(accepted==0 || first>opened+60 || last<opened+240)return;
 CachedAsk.time=(datetime)opened;CachedAsk.tick_volume=accepted;
 CachedAskOpen=opened;AskReady=true;
}
ENUM_TIMEFRAMES Frames[]={PERIOD_M5,PERIOD_M15,PERIOD_M30,PERIOD_H1,PERIOD_H4,PERIOD_W1,PERIOD_MN1};
string FrameNames[]={"M5","M15","M30","H1","H4","W1","MN1"};
string Esc(string value){StringReplace(value,"\\","\\\\");StringReplace(value,"\"","\\\"");StringReplace(value,"\r","\\r");StringReplace(value,"\n","\\n");return value;}
string Num(double value,int digits){return DoubleToString(value,digits);}
string Whole(long value){return StringFormat("%I64d",value);}
void ExportSnapshot(){
 MqlTick tick;
 if(!SymbolInfoTick(BridgeSymbol,tick) || tick.bid<=0 || tick.ask<tick.bid){Print("Panther: no valid quote; export withheld.");return;}
 int digits=(int)SymbolInfoInteger(BridgeSymbol,SYMBOL_DIGITS);
 // MT5 bar times remain broker-server wall time. They are NOT labelled UTC.
 // GMT is snapshot receipt time only; stale last-tick time remains separately visible.
 string data="{\"schema\":\"panther.mt5.snapshot.v1\",\"provider\":\"Vestrado MT5\",\"symbol\":\""+Esc(BridgeSymbol)+"\",\"exported_at_utc\":\""+TimeToString(TimeGMT(),TIME_DATE|TIME_SECONDS)+"\",\"bar_time_basis\":\"broker_server\",\"server_time_raw\":"+Whole((long)TimeTradeServer())+",\"digits\":"+IntegerToString(digits)+",\"point\":"+Num(SymbolInfoDouble(BridgeSymbol,SYMBOL_POINT),digits)+",\"quote\":{\"bid\":"+Num(tick.bid,digits)+",\"ask\":"+Num(tick.ask,digits)+",\"last_tick_time_raw\":"+Whole(tick.time)+",\"last_tick_time_msc_raw\":"+Whole(tick.time_msc)+"},\"series\":[";
 for(int f=0;f<ArraySize(Frames);f++){
  if(f>0)data+=",";
  MqlRates rates[];ArraySetAsSeries(rates,false);
  // shift=1 excludes the current unfinished candle; CopyRates stores oldest first.
  int copied=CopyRates(BridgeSymbol,Frames[f],1,HistoryBars,rates);
  data+="{\"timeframe\":\""+FrameNames[f]+"\",\"availability\":\""+(copied>0?"available":"unavailable")+"\",\"candles\":[";
  for(int i=0;i<copied;i++){
   if(i>0)data+=",";
   data+="{\"opened_at_server_raw\":"+Whole((long)rates[i].time)+",\"open\":"+Num(rates[i].open,digits)+",\"high\":"+Num(rates[i].high,digits)+",\"low\":"+Num(rates[i].low,digits)+",\"close\":"+Num(rates[i].close,digits)+",\"tick_volume\":"+Whole(rates[i].tick_volume)+",\"real_volume\":"+(rates[i].real_volume>0?Whole(rates[i].real_volume):"null")+",\"spread_points\":"+IntegerToString(rates[i].spread)+"}";
  }
  data+="]}";
 }
 UpdateAskM5();
 data+="],\"ask_m5\":[";
 if(AskReady){data+="{\"opened_at_server_raw\":"+Whole(CachedAskOpen)+",\"open\":"+Num(CachedAsk.open,digits)+",\"high\":"+Num(CachedAsk.high,digits)+",\"low\":"+Num(CachedAsk.low,digits)+",\"close\":"+Num(CachedAsk.close,digits)+",\"tick_volume\":"+Whole(CachedAsk.tick_volume)+",\"real_volume\":null,\"spread_points\":0}";}
 data+="],\"order_book\":";
 MqlBookInfo book[];
 if(domSubscribed && MarketBookGet(BridgeSymbol,book) && ArraySize(book)>0){
  data+="{\"scope\":\"broker_reported_only\",\"levels\":[";
  for(int j=0;j<ArraySize(book);j++){
   if(j>0)data+=",";
   data+="{\"type\":"+IntegerToString((int)book[j].type)+",\"price\":"+Num(book[j].price,digits)+",\"volume\":"+Whole(book[j].volume)+",\"volume_real\":"+DoubleToString(book[j].volume_real,8)+"}";
  }
  data+="]}";
 }else data+="null";
 // Tick volume and DOM are not aggressive buy/sell trade volume.
 data+=",\"aggressive_buy_sell_imbalance\":null,\"execution_enabled\":false}";
 string pending=OutputName+".tmp";
 int handle=FileOpen(pending,FILE_WRITE|FILE_TXT|FILE_ANSI|FILE_COMMON,0,CP_UTF8);
 if(handle==INVALID_HANDLE){Print("Panther: cannot open snapshot file; error ",GetLastError());return;}
 uint written=FileWriteString(handle,data);FileFlush(handle);FileClose(handle);
 if(written==0){Print("Panther: empty export withheld.");return;}
 if(!FileMove(pending,FILE_COMMON,OutputName,FILE_COMMON|FILE_REWRITE))Print("Panther: snapshot replacement failed; error ",GetLastError());
}
int OnInit(){
 if(HistoryBars<30 || HistoryBars>1000 || ExportEverySeconds<5 || ExportEverySeconds>3600)return INIT_PARAMETERS_INCORRECT;
 if(!SymbolSelect(BridgeSymbol,true)){Print("Panther: broker symbol not found: ",BridgeSymbol);return INIT_FAILED;}
 FolderCreate("PantherFX",FILE_COMMON);
 if(IncludeAvailableDOM)domSubscribed=MarketBookAdd(BridgeSymbol);
 if(!EventSetTimer(ExportEverySeconds))return INIT_FAILED;
 Print("Panther read-only exporter started for ",BridgeSymbol,". File: ",TerminalInfoString(TERMINAL_COMMONDATA_PATH),"\\Files\\",OutputName);
 ExportSnapshot();return INIT_SUCCEEDED;
}
void OnTimer(){ExportSnapshot();}
void OnDeinit(const int reason){EventKillTimer();if(domSubscribed)MarketBookRelease(BridgeSymbol);}
