
-- Cases table: Primary legal theories
CREATE TABLE public.cases (
    case_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_code VARCHAR(50) NOT NULL UNIQUE,
    case_name VARCHAR(255) NOT NULL,
    legal_theory VARCHAR(100) NOT NULL,
    statute_cited VARCHAR(100),
    description TEXT,
    status VARCHAR(50) DEFAULT 'active',
    priority INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators can view cases" ON public.cases
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can insert cases" ON public.cases
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update cases" ON public.cases
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- Exhibits table: Tiered exhibit registry
CREATE TABLE public.exhibits (
    exhibit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID NOT NULL REFERENCES public.cases(case_id) ON DELETE CASCADE,
    exhibit_code VARCHAR(10) NOT NULL UNIQUE,
    exhibit_name VARCHAR(255) NOT NULL,
    tier INTEGER NOT NULL,
    evidence_type VARCHAR(100),
    description TEXT,
    legal_significance TEXT,
    file_count INTEGER DEFAULT 0,
    promotion_rule TEXT,
    sha256_hash VARCHAR(64),
    chain_of_custody JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(50) DEFAULT 'draft',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.exhibits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators can view exhibits" ON public.exhibits
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can insert exhibits" ON public.exhibits
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update exhibits" ON public.exhibits
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- Promotion Rules table
CREATE TABLE public.promotion_rules (
    rule_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES public.cases(case_id) ON DELETE CASCADE,
    rule_name VARCHAR(255) NOT NULL,
    rule_category VARCHAR(50) NOT NULL,
    sql_condition TEXT NOT NULL,
    priority INTEGER DEFAULT 50,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.promotion_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators can view promotion rules" ON public.promotion_rules
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can insert promotion rules" ON public.promotion_rules
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can update promotion rules" ON public.promotion_rules
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- Exhibit Audit Trail (append-only)
CREATE TABLE public.exhibit_audit_trail (
    audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES public.cases(case_id),
    exhibit_id UUID REFERENCES public.exhibits(exhibit_id),
    action VARCHAR(100) NOT NULL,
    rule_applied TEXT,
    source_hash VARCHAR(64),
    result_hash VARCHAR(64),
    records_evaluated INTEGER,
    records_promoted INTEGER,
    performed_by TEXT DEFAULT 'system',
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

ALTER TABLE public.exhibit_audit_trail ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Investigators can view audit trail" ON public.exhibit_audit_trail
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Investigators can insert audit trail" ON public.exhibit_audit_trail
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'investigator') OR public.has_role(auth.uid(), 'admin'));

-- Indexes
CREATE INDEX idx_cases_status ON public.cases(status);
CREATE INDEX idx_exhibits_case ON public.exhibits(case_id);
CREATE INDEX idx_exhibits_tier ON public.exhibits(tier);
CREATE INDEX idx_exhibits_code ON public.exhibits(exhibit_code);
CREATE INDEX idx_promotion_rules_case ON public.promotion_rules(case_id);
CREATE INDEX idx_promotion_rules_active ON public.promotion_rules(is_active);
CREATE INDEX idx_audit_trail_case ON public.exhibit_audit_trail(case_id);
CREATE INDEX idx_audit_trail_exhibit ON public.exhibit_audit_trail(exhibit_id);
CREATE INDEX idx_audit_trail_time ON public.exhibit_audit_trail(performed_at);

-- Timestamp triggers
CREATE TRIGGER update_cases_updated_at
    BEFORE UPDATE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_exhibits_updated_at
    BEFORE UPDATE ON public.exhibits
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
