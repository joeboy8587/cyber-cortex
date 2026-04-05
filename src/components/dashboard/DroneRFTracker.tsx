import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Radio, Plus, RefreshCw, Signal } from "lucide-react";
import { neonQuery } from "@/lib/neonQueryRetry";
import { toast } from "sonner";

const COMMON_DRONE_FREQUENCIES = [
  { label: "2.4 GHz (WiFi/Consumer)", value: "2400" },
  { label: "5.8 GHz (FPV/Video)", value: "5800" },
  { label: "900 MHz (Long Range)", value: "900" },
  { label: "1.2 GHz (Military)", value: "1200" },
  { label: "433 MHz (LoRa)", value: "433" },
  { label: "915 MHz (ISM)", value: "915" },
];

export default function DroneRFTracker() {
  const [signatures, setSignatures] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    frequency_mhz: "",
    signal_strength_dbm: "",
    modulation_type: "",
    protocol: "",
    estimated_manufacturer: "",
    estimated_model: "",
    latitude: "35.43",
    longitude: "-119.05",
    altitude_ft: "",
    linked_ghost_callsign: "",
    linked_ghost_icao: "",
    confidence_score: "50",
    notes: "",
  });

  const refetch = async () => {
    setIsLoading(true);
    try {
      const { data } = await neonQuery({ action: "droneRFScan" });
      setSignatures(data?.signatures || []);
    } catch { /* ignore */ }
    setIsLoading(false);
  };

  const handleSubmit = async () => {
    try {
      const payload = {
        ...formData,
        frequency_mhz: parseFloat(formData.frequency_mhz) || null,
        signal_strength_dbm: parseFloat(formData.signal_strength_dbm) || null,
        altitude_ft: parseFloat(formData.altitude_ft) || null,
        confidence_score: parseFloat(formData.confidence_score) || 50,
      };
      await neonQuery({ action: "insertDroneRF", data: payload });
      toast.success("RF signature logged");
      setShowForm(false);
      refetch();
    } catch (e) {
      toast.error("Failed to log RF signature");
    }
  };


  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-card/80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Radio className="h-5 w-5 text-primary" />
              Drone RF Signature Tracker
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
              </Button>
              <Button size="sm" onClick={() => setShowForm(!showForm)}>
                <Plus className="h-4 w-4 mr-1" /> Log Signature
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {showForm && (
            <Card className="mb-4 border-accent/30 bg-accent/5">
              <CardContent className="pt-4 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Frequency (MHz)</Label>
                    <Select onValueChange={(v) => setFormData(p => ({ ...p, frequency_mhz: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {COMMON_DRONE_FREQUENCIES.map(f => (
                          <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Signal Strength (dBm)</Label>
                    <Input value={formData.signal_strength_dbm} onChange={e => setFormData(p => ({ ...p, signal_strength_dbm: e.target.value }))} placeholder="-40" />
                  </div>
                  <div>
                    <Label className="text-xs">Modulation</Label>
                    <Select onValueChange={(v) => setFormData(p => ({ ...p, modulation_type: v }))}>
                      <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FHSS">FHSS</SelectItem>
                        <SelectItem value="DSSS">DSSS</SelectItem>
                        <SelectItem value="OFDM">OFDM</SelectItem>
                        <SelectItem value="FSK">FSK</SelectItem>
                        <SelectItem value="Unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Protocol</Label>
                    <Select onValueChange={(v) => setFormData(p => ({ ...p, protocol: v }))}>
                      <SelectTrigger><SelectValue placeholder="Protocol" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DJI_OcuSync">DJI OcuSync</SelectItem>
                        <SelectItem value="DJI_Lightbridge">DJI Lightbridge</SelectItem>
                        <SelectItem value="WiFi_802.11">WiFi 802.11</SelectItem>
                        <SelectItem value="LoRa">LoRa</SelectItem>
                        <SelectItem value="Military_Link16">Link-16</SelectItem>
                        <SelectItem value="Unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Linked Ghost Callsign</Label>
                    <Input value={formData.linked_ghost_callsign} onChange={e => setFormData(p => ({ ...p, linked_ghost_callsign: e.target.value }))} placeholder="XXD" />
                  </div>
                  <div>
                    <Label className="text-xs">Linked Ghost ICAO</Label>
                    <Input value={formData.linked_ghost_icao} onChange={e => setFormData(p => ({ ...p, linked_ghost_icao: e.target.value }))} placeholder="AAA74E" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Notes</Label>
                  <Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} placeholder="Signal characteristics, direction..." rows={2} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSubmit}>Save Signature</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Scanning RF signatures...</div>
          ) : signatures.length === 0 ? (
            <div className="text-center py-8">
              <Signal className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No RF signatures logged yet. Click "Log Signature" to begin tracking.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Freq (MHz)</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Linked Ghost</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signatures.slice(0, 20).map((sig: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">{new Date(sig.detection_timestamp).toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{sig.frequency_mhz || "?"} MHz</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{sig.signal_strength_dbm || "?"} dBm</TableCell>
                    <TableCell className="text-xs">{sig.protocol || sig.modulation_type || "?"}</TableCell>
                    <TableCell>
                      {sig.linked_ghost_callsign && (
                        <Badge variant="destructive" className="text-xs">{sig.linked_ghost_callsign}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sig.confidence_score >= 70 ? "destructive" : "secondary"}>
                        {sig.confidence_score}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
