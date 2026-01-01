import { useState, useCallback, useEffect } from 'react';
import { CyberPanel } from '../ui/cyber-panel';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Alert, AlertDescription } from '../ui/alert';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { toast } from 'sonner';
import { 
  Calculator, 
  DollarSign, 
  AlertTriangle,
  Scale,
  TrendingUp,
  Plane,
  Target,
  Zap,
  Award
} from 'lucide-react';

interface DamageCategory {
  id: string;
  name: string;
  description: string;
  baseAmount: number;
  multiplier: number;
  total: number;
  statute: string;
}

const DamagesCalculator = () => {
  const [faaViolations, setFaaViolations] = useState(5000);
  const [falseClaimsAmount, setFalseClaimsAmount] = useState(1000000);
  const [wirefraudCounts, setWirefraudCounts] = useState(100);
  const [civilRightsMultiplier, setCivilRightsMultiplier] = useState(3);
  const [punitiveFactor, setPunitiveFactor] = useState(5);
  
  const [categories, setCategories] = useState<DamageCategory[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [lowEstimate, setLowEstimate] = useState(0);
  const [highEstimate, setHighEstimate] = useState(0);

  const calculate = useCallback(() => {
    const newCategories: DamageCategory[] = [
      {
        id: 'faa',
        name: 'FAA Civil Penalties',
        description: `${faaViolations.toLocaleString()} violations × $50,000 max per violation`,
        baseAmount: 50000,
        multiplier: faaViolations,
        total: faaViolations * 50000,
        statute: '49 U.S.C. § 46301'
      },
      {
        id: 'fca_base',
        name: 'False Claims Act - Base',
        description: 'Federal funds obtained through fraud',
        baseAmount: falseClaimsAmount,
        multiplier: 1,
        total: falseClaimsAmount,
        statute: '31 U.S.C. § 3729'
      },
      {
        id: 'fca_treble',
        name: 'False Claims Act - Treble Damages',
        description: 'Mandatory 3x multiplier for FCA violations',
        baseAmount: falseClaimsAmount,
        multiplier: 3,
        total: falseClaimsAmount * 3,
        statute: '31 U.S.C. § 3729(a)(1)(G)'
      },
      {
        id: 'fca_penalty',
        name: 'FCA Per-Claim Penalties',
        description: 'Civil penalty per false claim ($13,508 - $27,018)',
        baseAmount: 20000,
        multiplier: wirefraudCounts,
        total: wirefraudCounts * 20000,
        statute: '31 U.S.C. § 3729(a)(1)'
      },
      {
        id: 'wirefraud',
        name: 'Wire Fraud Damages',
        description: `${wirefraudCounts} counts of false ADS-B transmission`,
        baseAmount: 250000,
        multiplier: wirefraudCounts,
        total: wirefraudCounts * 250000,
        statute: '18 U.S.C. § 1343'
      },
      {
        id: 'civilrights',
        name: 'Civil Rights Compensatory',
        description: `Fourth Amendment violations (${civilRightsMultiplier}x compensatory)`,
        baseAmount: 500000,
        multiplier: civilRightsMultiplier,
        total: 500000 * civilRightsMultiplier,
        statute: '42 U.S.C. § 1983'
      },
      {
        id: 'punitive',
        name: 'Punitive Damages',
        description: `Government misconduct factor (${punitiveFactor}x)`,
        baseAmount: 1000000,
        multiplier: punitiveFactor,
        total: 1000000 * punitiveFactor,
        statute: 'BMW v. Gore, 517 U.S. 559 (1996)'
      }
    ];

    const total = newCategories.reduce((sum, cat) => sum + cat.total, 0);
    
    setCategories(newCategories);
    setGrandTotal(total);
    setLowEstimate(total * 0.3);
    setHighEstimate(total * 1.2);
    
    toast.success('Damages Calculated', {
      description: `Total exposure: $${total.toLocaleString()}`
    });
  }, [faaViolations, falseClaimsAmount, wirefraudCounts, civilRightsMultiplier, punitiveFactor]);

  useEffect(() => {
    calculate();
  }, []);

  const formatCurrency = (amount: number): string => {
    if (amount >= 1000000000) {
      return `$${(amount / 1000000000).toFixed(2)}B`;
    } else if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    } else if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(0)}K`;
    }
    return `$${amount.toLocaleString()}`;
  };

  return (
    <CyberPanel 
      title="Damages Calculator" 
      icon={<Calculator className="text-chart-1" />}
      className="col-span-full"
    >
      <Alert className="mb-4 border-chart-1/50 bg-chart-1/10">
        <Scale className="h-4 w-4" />
        <AlertDescription>
          <strong>Total Exposure Calculator:</strong> Computes FAA penalties, False Claims treble damages, wire fraud, and civil rights damages.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Controls */}
        <div className="space-y-4">
          <h3 className="font-bold flex items-center gap-2 text-sm">
            <Target className="h-4 w-4" />
            Violation Parameters
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground flex justify-between">
                <span>FAA Violations</span>
                <span className="font-mono">{faaViolations.toLocaleString()}</span>
              </label>
              <Slider
                value={[faaViolations]}
                onValueChange={(v) => setFaaViolations(v[0])}
                min={100}
                max={10000}
                step={100}
                className="mt-2"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground flex justify-between">
                <span>False Claims Base ($)</span>
                <span className="font-mono">{formatCurrency(falseClaimsAmount)}</span>
              </label>
              <Slider
                value={[falseClaimsAmount]}
                onValueChange={(v) => setFalseClaimsAmount(v[0])}
                min={100000}
                max={10000000}
                step={100000}
                className="mt-2"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground flex justify-between">
                <span>Wire Fraud Counts</span>
                <span className="font-mono">{wirefraudCounts}</span>
              </label>
              <Slider
                value={[wirefraudCounts]}
                onValueChange={(v) => setWirefraudCounts(v[0])}
                min={10}
                max={500}
                step={10}
                className="mt-2"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground flex justify-between">
                <span>Civil Rights Multiplier</span>
                <span className="font-mono">{civilRightsMultiplier}x</span>
              </label>
              <Slider
                value={[civilRightsMultiplier]}
                onValueChange={(v) => setCivilRightsMultiplier(v[0])}
                min={1}
                max={10}
                step={1}
                className="mt-2"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground flex justify-between">
                <span>Punitive Factor</span>
                <span className="font-mono">{punitiveFactor}x</span>
              </label>
              <Slider
                value={[punitiveFactor]}
                onValueChange={(v) => setPunitiveFactor(v[0])}
                min={1}
                max={10}
                step={1}
                className="mt-2"
              />
            </div>
          </div>

          <Button onClick={calculate} className="w-full">
            <Zap className="mr-2 h-4 w-4" />
            Recalculate
          </Button>
        </div>

        {/* Breakdown */}
        <div className="lg:col-span-2">
          <h3 className="font-bold flex items-center gap-2 text-sm mb-4">
            <DollarSign className="h-4 w-4" />
            Damages Breakdown
          </h3>

          <ScrollArea className="h-[300px]">
            {categories.map((cat) => (
              <div key={cat.id} className="p-3 mb-2 rounded border border-border bg-muted/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">{cat.name}</span>
                  <span className="font-bold text-chart-1">{formatCurrency(cat.total)}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-1">{cat.description}</p>
                <Badge variant="outline" className="text-xs">{cat.statute}</Badge>
              </div>
            ))}
          </ScrollArea>

          {/* Totals */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="p-3 rounded border border-border bg-muted/30 text-center">
              <p className="text-xs text-muted-foreground">Low Estimate</p>
              <p className="text-lg font-bold">{formatCurrency(lowEstimate)}</p>
            </div>
            <div className="p-3 rounded border border-destructive bg-destructive/10 text-center">
              <p className="text-xs text-muted-foreground">Grand Total</p>
              <p className="text-2xl font-bold text-destructive">{formatCurrency(grandTotal)}</p>
            </div>
            <div className="p-3 rounded border border-border bg-muted/30 text-center">
              <p className="text-xs text-muted-foreground">High Estimate</p>
              <p className="text-lg font-bold">{formatCurrency(highEstimate)}</p>
            </div>
          </div>

          <div className="mt-4 p-3 rounded border border-chart-1/50 bg-chart-1/10">
            <div className="flex items-center gap-2 mb-2">
              <Award className="h-4 w-4 text-chart-1" />
              <span className="font-bold text-sm">Qui Tam Relator Share</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">If Government Intervenes (15-25%)</p>
                <p className="font-bold">{formatCurrency(grandTotal * 0.20)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">If Relator Proceeds (25-30%)</p>
                <p className="font-bold">{formatCurrency(grandTotal * 0.275)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CyberPanel>
  );
};

export default DamagesCalculator;
