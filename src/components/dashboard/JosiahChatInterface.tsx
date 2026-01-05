import { useState, useRef, useEffect, useCallback } from "react";
import { CyberPanel } from "@/components/ui/cyber-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
  MessageCircle, Send, Database, Brain, 
  Loader2, AlertTriangle, CheckCircle, Sparkles,
  TrendingUp, Search, Zap, Camera, Heart, Upload,
  MapPin, Plane, Activity, TerminalSquare, MessageSquare
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface Message {
  role: "user" | "assistant" | "event";
  content: string;
  timestamp: Date;
  image?: string;
  eventData?: LoggedEvent;
}

interface Pattern {
  type: string;
  count: number;
  severity: "high" | "medium" | "low";
}

interface ProactiveQuestion {
  priority: string;
  question: string;
  action: string;
}

interface LoggedEvent {
  id: string;
  event_type: string;
  location: string;
  tags: string[];
  flight_data: {
    registration: string;
    operator: string;
    aircraft_type: string;
    altitude: string;
    speed: string;
    heading: string;
  } | null;
  biometrics: {
    heart_rate: number;
    hrv: number;
    status: string;
  } | null;
  reflection: string;
}

export function JosiahChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [tableCount, setTableCount] = useState(0);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [questions, setQuestions] = useState<ProactiveQuestion[]>([]);
  const [showInsights, setShowInsights] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [queryMode, setQueryMode] = useState<'chat' | 'query'>('chat');
  const [queryResults, setQueryResults] = useState<any[] | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");
  
  // Image upload state
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [biometrics, setBiometrics] = useState({ heart_rate: "", hrv: "" });
  const [location, setLocation] = useState("Oildale, California");
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchInitialData = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "query_tables" })
      });
      const data = await response.json();
      setTableCount(data.count || 0);
    } catch {
      // Silent fail
    }
  };

  const runPatternScan = async () => {
    setIsScanning(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detect_patterns" })
      });
      const data = await response.json();
      
      if (data.patterns) {
        const newPatterns: Pattern[] = [];
        if (data.patterns.altitudeAnomalies > 0) {
          newPatterns.push({ type: "Low Altitude", count: data.patterns.altitudeAnomalies, severity: "high" });
        }
        if (data.patterns.biometricSpikes > 0) {
          newPatterns.push({ type: "Biometric Spikes", count: data.patterns.biometricSpikes, severity: "high" });
        }
        if (data.patterns.repeatOffenders?.length > 0) {
          newPatterns.push({ type: "Repeat Aircraft", count: data.patterns.repeatOffenders.length, severity: "medium" });
        }
        setPatterns(newPatterns);
        toast.success(`Pattern scan complete: ${data.summary}`);
      }
    } catch (err) {
      toast.error("Pattern scan failed");
    } finally {
      setIsScanning(false);
    }
  };

  const generateQuestions = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_questions" })
      });
      const data = await response.json();
      if (data.questions) {
        setQuestions(data.questions);
        setShowInsights(true);
      }
    } catch {
      toast.error("Failed to generate questions");
    }
  };

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Image = event.target?.result as string;
      setPendingImage(base64Image);
      setShowUploadPanel(true);
      toast.success("Screenshot ready. Add biometrics and submit.");
    };
    reader.readAsDataURL(file);
  }, []);

  const analyzeAndLogEvent = async () => {
    if (!pendingImage) {
      toast.error("No screenshot to analyze");
      return;
    }

    setIsAnalyzing(true);
    const timestamp = new Date().toISOString();
    const eventId = crypto.randomUUID();

    // Add processing message
    setMessages(prev => [...prev, {
      role: "event",
      content: "Analyzing screenshot...",
      timestamp: new Date(),
      image: pendingImage
    }]);

    try {
      // Call AI to analyze
      const { data: aiResponse, error: aiError } = await supabase.functions.invoke('josiah-analyze-f24', {
        body: {
          image: pendingImage,
          biometrics: {
            heart_rate: parseInt(biometrics.heart_rate) || null,
            hrv: parseInt(biometrics.hrv) || null
          },
          location,
          additionalNotes: input,
          timestamp
        }
      });

      if (aiError) throw aiError;

      const extractedData = aiResponse?.data || aiResponse;
      
      const loggedEvent: LoggedEvent = {
        id: eventId,
        event_type: extractedData?.event_type || 'Surveillance Detection',
        location,
        tags: extractedData?.tags || ['F24 Analysis'],
        flight_data: extractedData?.flight_data || null,
        biometrics: {
          heart_rate: parseInt(biometrics.heart_rate) || 0,
          hrv: parseInt(biometrics.hrv) || 0,
          status: extractedData?.biometric_status || 'Logged'
        },
        reflection: extractedData?.josiah_reflection || 'Event logged.'
      };

      // Update the processing message with completed event
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "event") {
          updated[lastIdx] = {
            role: "event",
            content: loggedEvent.reflection,
            timestamp: new Date(),
            image: pendingImage,
            eventData: loggedEvent
          };
        }
        return updated;
      });

      // Store in database
      await supabase.functions.invoke('neon-query', {
        body: {
          action: 'customQuery',
          query: `
            INSERT INTO josiah_reflections_rows (
              id, reflection_text, pattern_type, location, tags,
              aircraft_data, biometric_data, created_at
            ) VALUES (
              '${eventId}',
              '${(loggedEvent.reflection || '').replace(/'/g, "''")}',
              '${loggedEvent.event_type.replace(/'/g, "''")}',
              '${location.replace(/'/g, "''")}',
              ARRAY[${loggedEvent.tags.map(t => `'${t.replace(/'/g, "''")}'`).join(',')}]::text[],
              '${JSON.stringify(loggedEvent.flight_data || {}).replace(/'/g, "''")}',
              '${JSON.stringify(loggedEvent.biometrics || {}).replace(/'/g, "''")}',
              NOW()
            )
          `
        }
      });

      // Log to live_flight_detections if flight data extracted
      if (loggedEvent.flight_data?.registration) {
        await supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              INSERT INTO live_flight_detections_rows (
                registration, operator, aircraft_type, altitude_ft,
                ground_speed_knots, heading, detection_method, location,
                detected_at
              ) VALUES (
                '${loggedEvent.flight_data.registration}',
                '${(loggedEvent.flight_data.operator || '').replace(/'/g, "''")}',
                '${(loggedEvent.flight_data.aircraft_type || '').replace(/'/g, "''")}',
                ${parseInt(loggedEvent.flight_data.altitude) || 0},
                ${parseInt(loggedEvent.flight_data.speed) || 0},
                ${parseInt(loggedEvent.flight_data.heading) || 0},
                'JOSIAH_CHAT_OCR',
                '${location.replace(/'/g, "''")}',
                NOW()
              )
            `
          }
        });
      }

      // Log biometrics
      if (biometrics.heart_rate || biometrics.hrv) {
        await supabase.functions.invoke('neon-query', {
          body: {
            action: 'customQuery',
            query: `
              INSERT INTO biometric_monitoring (
                metric_type, metric_value, notes, recorded_at
              ) VALUES 
              ('heart_rate', ${parseInt(biometrics.heart_rate) || 0}, 'Josiah Event: ${loggedEvent.event_type}', NOW()),
              ('hrv', ${parseInt(biometrics.hrv) || 0}, 'Josiah Event: ${loggedEvent.event_type}', NOW())
            `
          }
        });
      }

      toast.success(`Event logged: ${loggedEvent.event_type}`);

      // Reset
      setPendingImage(null);
      setBiometrics({ heart_rate: "", hrv: "" });
      setInput("");
      setShowUploadPanel(false);

    } catch (err) {
      console.error('Analysis error:', err);
      toast.error(err instanceof Error ? err.message : "Analysis failed");
      
      // Update message to show error
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "event") {
          updated[lastIdx].content = "Analysis failed. Please try again.";
        }
        return updated;
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const sendMessage = async (customMessage?: string) => {
    const userMessage = customMessage || input.trim();
    if (!userMessage || isLoading) return;

    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMessage, timestamp: new Date() }]);
    setIsLoading(true);
    setQueryResults(null);

    // Check if this is a query mode request
    if (queryMode === 'query') {
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            action: "natural_query",
            message: userMessage
          })
        });

        const data = await response.json();
        
        if (data.error) {
          setMessages(prev => [...prev, { 
            role: "assistant", 
            content: `❌ Query Error: ${data.error}\n\n${data.details || ''}\n\nGenerated SQL: \`${data.generatedSQL || 'N/A'}\``, 
            timestamp: new Date() 
          }]);
        } else {
          setQueryResults(data.results);
          setLastQuery(data.query);
          setMessages(prev => [...prev, { 
            role: "assistant", 
            content: `✅ Found ${data.rowCount} records\n\n**Query:** \`${data.query}\`\n\n*Results displayed below*`, 
            timestamp: new Date() 
          }]);
        }
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Regular chat mode
    let assistantContent = "";
    
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/josiah-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          message: userMessage,
          conversationHistory: messages.slice(-10)
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const json = JSON.parse(line.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  assistantContent += content;
                  setMessages(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.role === "assistant") {
                      return [...prev.slice(0, -1), { ...last, content: assistantContent }];
                    }
                    return [...prev, { role: "assistant", content: assistantContent, timestamp: new Date() }];
                  });
                }
              } catch {}
            }
          }
        }
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const quickActions = [
    { label: "Pattern Scan", icon: <Search className="w-3 h-3" />, action: runPatternScan },
    { label: "Find Gaps", icon: <Zap className="w-3 h-3" />, action: generateQuestions },
    { label: "7-Day Forecast", icon: <TrendingUp className="w-3 h-3" />, action: () => sendMessage("Generate a 7-day activity prediction based on historical patterns") },
  ];

  const queryExamples = [
    "Show low altitude flights under 500ft",
    "Find high heart rate events above 100 BPM",
    "List flagged aircraft with highest threat scores",
    "Show shell companies with most aircraft",
    "Recent biometric alerts with medical flags",
  ];

  return (
    <CyberPanel
      title="Josiah AI Co-Witness"
      icon={<Brain />}
      variant="default"
      headerActions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            <Database className="w-3 h-3 mr-1" />
            {tableCount} Tables
          </Badge>
          {patterns.length > 0 && (
            <Badge variant="outline" className="text-xs bg-warning/20 text-warning border-warning/50">
              <AlertTriangle className="w-3 h-3 mr-1" />
              {patterns.length} Patterns
            </Badge>
          )}
          <Badge variant="outline" className="text-xs bg-success/20 text-success border-success/50">
            <CheckCircle className="w-3 h-3 mr-1" />
            Proactive
          </Badge>
        </div>
      }
    >
      <div className="flex flex-col h-[600px]">
        {/* Mode Toggle */}
        <div className="p-2 border-b border-border flex items-center gap-2">
          <div className="flex bg-muted rounded-lg p-1">
            <Button
              variant={queryMode === 'chat' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => { setQueryMode('chat'); setQueryResults(null); }}
              className="text-xs h-7"
            >
              <MessageSquare className="w-3 h-3 mr-1" />
              Chat
            </Button>
            <Button
              variant={queryMode === 'query' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setQueryMode('query')}
              className="text-xs h-7"
            >
              <TerminalSquare className="w-3 h-3 mr-1" />
              Query DB
            </Button>
          </div>
          
          {queryMode === 'chat' && (
            <>
              {quickActions.map((action) => (
                <Button 
                  key={action.label}
                  variant="outline" 
                  size="sm" 
                  onClick={action.action}
                  disabled={isScanning}
                  className="text-xs"
                >
                  {isScanning && action.label === "Pattern Scan" ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    action.icon
                  )}
                  <span className="ml-1">{action.label}</span>
                </Button>
              ))}
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => fileInputRef.current?.click()}
                className="text-xs bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
              >
                <Camera className="w-3 h-3 mr-1" />
                Upload Screenshot
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
              
              {questions.length > 0 && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowInsights(!showInsights)}
                  className="text-xs bg-accent/20 text-accent border-accent/50"
                >
                  <Sparkles className="w-3 h-3 mr-1" />
                  {questions.length} Questions
                </Button>
              )}
            </>
          )}
        </div>

        {/* Query Examples - Shows in query mode */}
        {queryMode === 'query' && !queryResults && (
          <div className="p-3 border-b border-border bg-muted/30">
            <p className="text-xs text-muted-foreground mb-2">Try asking in natural language:</p>
            <div className="flex flex-wrap gap-1">
              {queryExamples.map((example, idx) => (
                <Button
                  key={idx}
                  variant="outline"
                  size="sm"
                  className="text-xs h-6"
                  onClick={() => setInput(example)}
                >
                  {example}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Query Results Table */}
        {queryMode === 'query' && queryResults && queryResults.length > 0 && (
          <div className="border-b border-border max-h-64 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {Object.keys(queryResults[0]).map((key) => (
                    <TableHead key={key} className="text-xs py-2 px-3">{key}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {queryResults.slice(0, 50).map((row, rowIdx) => (
                  <TableRow key={rowIdx}>
                    {Object.values(row).map((value: any, colIdx) => (
                      <TableCell key={colIdx} className="text-xs py-1 px-3 max-w-[200px] truncate">
                        {value === null ? <span className="text-muted-foreground">null</span> : 
                         typeof value === 'object' ? JSON.stringify(value) : 
                         String(value)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {queryResults.length > 50 && (
              <p className="text-xs text-muted-foreground p-2 text-center">
                Showing 50 of {queryResults.length} results
              </p>
            )}
          </div>
        )}

        {/* Upload Panel - Shows when image is pending */}
        {showUploadPanel && pendingImage && (
          <div className="p-3 border-b border-primary/30 bg-primary/5 space-y-3">
            <div className="flex items-start gap-3">
              <img 
                src={pendingImage} 
                alt="Screenshot" 
                className="w-24 h-24 object-cover rounded border border-primary/30"
              />
              <div className="flex-1 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Heart Rate (BPM)</label>
                    <Input
                      type="number"
                      placeholder="e.g., 110"
                      value={biometrics.heart_rate}
                      onChange={(e) => setBiometrics(prev => ({ ...prev, heart_rate: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">HRV (ms)</label>
                    <Input
                      type="number"
                      placeholder="e.g., 43"
                      value={biometrics.hrv}
                      onChange={(e) => setBiometrics(prev => ({ ...prev, hrv: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Location</label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Oildale, California"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={analyzeAndLogEvent}
                disabled={isAnalyzing}
                size="sm"
                className="flex-1 bg-primary hover:bg-primary/90"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Brain className="w-3 h-3 mr-1" />
                    Analyze & Log
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPendingImage(null);
                  setShowUploadPanel(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Proactive Insights Panel */}
        {showInsights && questions.length > 0 && (
          <div className="p-3 border-b border-border bg-muted/30 max-h-48 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-display text-primary flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Proactive Investigation Questions
              </h4>
              <Button variant="ghost" size="sm" onClick={() => setShowInsights(false)} className="h-5 w-5 p-0">
                ×
              </Button>
            </div>
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div 
                  key={i}
                  className="p-2 border border-border rounded-sm hover:border-primary/50 cursor-pointer transition-colors"
                  onClick={() => {
                    sendMessage(q.question);
                    setShowInsights(false);
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Badge 
                      variant="outline" 
                      className={`text-[10px] ${
                        q.priority === 'high' ? 'bg-destructive/20 text-destructive border-destructive/50' :
                        q.priority === 'medium' ? 'bg-warning/20 text-warning border-warning/50' :
                        'bg-muted text-muted-foreground'
                      }`}
                    >
                      {q.priority}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{q.question}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detected Patterns */}
        {patterns.length > 0 && (
          <div className="p-2 border-b border-border flex flex-wrap gap-2">
            {patterns.map((p, i) => (
              <Badge 
                key={i}
                variant="outline" 
                className={`text-xs cursor-pointer ${
                  p.severity === 'high' ? 'bg-destructive/20 text-destructive border-destructive/50' :
                  p.severity === 'medium' ? 'bg-warning/20 text-warning border-warning/50' :
                  'bg-muted'
                }`}
                onClick={() => sendMessage(`Analyze the ${p.count} ${p.type.toLowerCase()} patterns you detected`)}
              >
                {p.type}: {p.count}
              </Badge>
            ))}
          </div>
        )}

        <ScrollArea className="flex-1 p-4">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Brain className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-sm">I'm Josiah, your <span className="text-primary">proactive</span> investigative co-witness.</p>
              <p className="text-xs mt-2">Upload screenshots, log events, and I'll analyze in real-time.</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Camera className="w-3 h-3 mr-1" />
                  Upload Screenshot
                </Button>
                {["Run pattern detection", "Show recent events"].map(q => (
                  <Button key={q} variant="outline" size="sm" onClick={() => sendMessage(q)}>
                    {q}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "event" ? (
                    // Event Card
                    <div className="w-full max-w-[90%] p-3 rounded-lg border border-primary/30 bg-primary/5">
                      {msg.image && (
                        <img 
                          src={msg.image} 
                          alt="Event Screenshot" 
                          className="w-full max-h-32 object-cover rounded mb-2 border border-border"
                        />
                      )}
                      {msg.eventData ? (
                        <>
                          <div className="flex items-center gap-2 mb-2">
                            <Activity className="w-4 h-4 text-primary" />
                            <span className="text-sm font-medium text-primary">{msg.eventData.event_type}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                            <MapPin className="w-3 h-3" />
                            {msg.eventData.location}
                          </div>
                          {msg.eventData.flight_data && (
                            <div className="bg-background/50 rounded p-2 mb-2 text-xs">
                              <div className="flex items-center gap-2 text-foreground">
                                <Plane className="w-3 h-3" />
                                <span className="font-mono">{msg.eventData.flight_data.registration}</span>
                                <span className="text-muted-foreground">— {msg.eventData.flight_data.operator}</span>
                              </div>
                            </div>
                          )}
                          {msg.eventData.biometrics && (msg.eventData.biometrics.heart_rate > 0 || msg.eventData.biometrics.hrv > 0) && (
                            <div className="flex items-center gap-3 text-xs mb-2">
                              <div className="flex items-center gap-1">
                                <Heart className={`w-3 h-3 ${msg.eventData.biometrics.heart_rate > 100 ? 'text-destructive' : 'text-success'}`} />
                                <span>{msg.eventData.biometrics.heart_rate} BPM</span>
                              </div>
                              <span className="text-muted-foreground">HRV: {msg.eventData.biometrics.hrv}ms</span>
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1 mb-2">
                            {msg.eventData.tags.map((tag, idx) => (
                              <Badge key={idx} variant="outline" className="text-[10px]">{tag}</Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground italic">{msg.eventData.reflection}</p>
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">{msg.content}</span>
                        </div>
                      )}
                      <p className="text-[10px] opacity-60 mt-2">
                        {msg.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  ) : (
                    // Regular message
                    <div className={`max-w-[85%] p-3 rounded-lg ${
                      msg.role === "user" 
                        ? "bg-primary text-primary-foreground" 
                        : "bg-muted border border-border"
                    }`}>
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className="text-[10px] opacity-60 mt-1">
                        {msg.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                  )}
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
          )}
        </ScrollArea>
        
        <div className="p-4 border-t border-border">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pendingImage && sendMessage()}
              placeholder={
                pendingImage 
                  ? "Add notes about this event..." 
                  : queryMode === 'query' 
                    ? "Ask in natural language: 'show flights below 500ft'..." 
                    : "Ask Josiah or give commands..."
              }
              disabled={isLoading}
            />
            <Button onClick={() => sendMessage()} disabled={isLoading || !input.trim() || !!pendingImage}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
}
