"""Rule engine: raw T12 line item -> code. side = 'inc' or 'exp'."""
import re

CATEGORY = {
    'mkt': 'Potential Market Rent', 'ltl': 'Loss to Lease', 'conc': 'Concessions',
    'vac': 'Vacancy', 'nr': 'Non-Revenue Units', 'cl': 'Collection Loss',
    'oinc': 'Other Residential Income', 'rubs': 'RUBS', 'park': 'Parking',
    'comm': 'Commercial', 'CAM': 'CAM', 'smart': 'Bulk Internet Income',
    'pers': 'Personnel', 'rm': 'Repair & Maintenance', 'turn': 'Turnover / Make-Ready',
    'adv': 'Marketing / Advertising', 'admin': 'Administrative', 'util': 'Utilities',
    'wat': 'Water & Sewer', 'mgt': 'Property Management Fee', 'ret': 'Real Estate Taxes',
    'ins': 'Insurance', 'door': 'Doorman', 'fran': 'Franchise Tax',
    'oexp': 'Other Operating Expenses', 'smartex': 'Bulk Internet Expense',
}
INCOME_CODES = {'mkt', 'ltl', 'conc', 'vac', 'nr', 'cl', 'oinc', 'rubs', 'park', 'comm', 'CAM', 'smart'}

def norm(t):
    t = str(t).lower()
    t = re.sub(r'^[\s:]*[\d][\d\-\.\s]*', '', t)      # leading GL numbers
    t = t.replace('&', ' and ').replace('–', '-')
    t = re.sub(r'[^a-z0-9/%\+ ]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

# Excluded (blank code) regardless of side: below-NOI, non-cash, capital, owner-level.
EXCLUDE = r'(depreciat|amortiz(?!ation of conc)|mortgage|interest expense|loan|debt service|principal|' \
          r'capital (improv|expend)|capex|cap ex|renovation project|asset management|partnership|' \
          r'owner (distribution|draw|fee|expense|contribution)|distribution|preferred return|investor|do not use|prior year tax|income tax|' \
          r'non operating|nonoperating|extraordinary|replacement reserve|reserve deposit|escrow|' \
          r'intercompany|suspense|clearing|security deposit (held|liab))'

INC_RULES = [
    (r'^bad debt recover|^bad debt collections?$|bad debt - (rent |other )?recover|recoveries? - credit', 'cl'),
    (r'bad debt|write ?off|written off|collection loss|arrears|former resident collect|collections from prior', 'cl'),
    (r'loss to lease|gain to lease|loss/gain|gain/loss|g/l to lease|gain loss|loss gain|under/over market|loss on market', 'ltl'),
    (r'employee|teammate|associate disc|model|courtesy officer|staff unit|admin unit|office unit|down unit|non ?rev|rehab|repositioned', 'nr'),
    (r'vacan', 'vac'),
    (r'concess|free rent|gift card|move in special|disc - ', 'conc'),
    (r'\bcam\b|tax (recovery|passthrough)|insurance recovery|common area maint', 'CAM'),
    (r'commercial|retail|\bcomm\b', 'comm'),
    (r'cable|internet|satellite|telecom|wifi|wi fi|broadband|bulk service|smart ?home|technology (fee|income|package)', 'smart'),
    (r'hud utility|tenant utility allowance|untransferred util|utility billing fee$|move out\)', 'oinc'),
    (r'utility|utilities|water|sewer|electric|\bgas\b|trash|garbage|valet|drainage|rubs|thermal|recoveries - (water|gas|elec|bulk|valet|util)', 'rubs'),
    (r'pest', 'rubs'),
    (r'mtm|month to month|pet|storage|parking|garage|carport|premium', 'oinc'),
    (r'gross pot|potential rent|market rent|gpr|^rents?\b|rent income$|rental income|subsid|voucher|\bhap\b|section 8|affordable|rents - unit|^rent - (potential|mtm)', 'mkt'),
    (r'.', 'oinc'),
]
SEC_EXP = [
    (r'payroll|personnel|salar|wage|benefit', 'pers'),
    (r'turn|make ?ready|mkrdy|unit occupied|interior unit|decorat', 'turn'),
    (r'retention|resident relation|resident event', 'adv'),
    (r'market|advertis|promot|leasing', 'adv'),
    (r'admin|g and a|g&a|general', 'admin'),
]
EXP_STRONG = [
    (r'management fee|mgmt fee|managment fee|revenue mgmt fee|information management fee', 'mgt'),
    (r'franchise tax', 'fran'),
    (r'tax (consult|protest|appeal|service)|professional fees - real estate|personal property tax|commercial activity|other (business )?tax|sales (and use )?tax|taxes - other', 'admin'),
    (r'^ret other|other ret', 'admin'),
    (r'real estate tax|property tax|real property|re tax|state activity tax|^taxes - real|^ret\b', 'ret'),
    (r'workers? comp|workman|unemployment|life ins|medical ins|health|dental|insurance benefit|employee life', 'pers'),
    (r'renters? (legal )?liab|rll|resident insurance|placed insurance|fp liability|renter s protection|waiver deposit|deposit waiver', 'admin'),
    (r'insurance|umbrella', 'ins'),
    (r'employee unit|employee apartment|model unit|admin/model', 'nr'),   # expense-side -> FLIP to Non-Revenue
    (r'(bulk|resident|unit|contract)\b.*(cable|internet)|^(cable|internet)( expense| tv)?$|(internet|cable) and (cable|internet)|cable ?/ ?internet|internet ?/ ?cable|cable tv|telecom - (unit|common area cable)|streaming|satellite', 'smartex'),
    (r'(rebill|billback|bill back).*service fee|service fee.*(rebill|reimburs)|utility rebill service', 'oinc'),   # expense-side income -> FLIP
    (r'rebill|billback|bill back|(util|water|sewer|electric|gas|trash|pest|drainage).*(reimburs|recover|collection)', 'rubs'),   # expense-side income -> FLIP
    (r'pest|extermin|bed bug|termite|vermin', 'util'),
    (r'water (damage|extract|intrusion|treatment|softener)|sewer repair', 'rm'),
    (r'water|sewer|wastewater|drainage|irrigation/sprinkler', 'wat'),
    (r'electrical (repair|supplies|services|fixtures)|supplies - electrical|improvements - electrical|light bulb|trash equipment', 'rm'),
    (r'electric|\bgas\b|natural gas|trash|garbage|waste management|refuse|recycl|compactor|valet|utilit|fuel oil|steam', 'util'),
    (r'payroll|salar|wage|bonus|401|fica|futa|suta|incentive|commission|overtime|temp(orary)? (help|labor|personnel|outside)|leasing (agent|team|salary)|manager|maintenance (tech|labor|team|supervisor|salar|super)|assistant maint|asst maint|porter|recruit|teammate', 'pers'),
    (r'concierge|front desk|doorman', 'pers'),
    (r'cleaning - common|cleaning common|common area clean', 'rm'),
    (r'make ready|mkrdy|turn ?over|turnkey|turn (cost|expense)|vacant unit (clean|haul)|(clean|paint|carpet|floor).* vacant|vacant .*(clean|paint|carpet)|punch|trashout|resurfac|glaz|refinish', 'turn'),
]
EXP_WEAK = [
    (r'advertis|marketing|mktg|promot|locator|referral|ils\b|internet ads|website|resident (retention|activit|event|function|relation|life)|tenant relations|prospect|brochure|collateral|seo|ppc|reputation|newsletter|broker(age)? fee|call center|model furnish|design work|hospitality', 'adv'),
    (r'cable|internet|telecom|telephone|phone|software|computer|technolog|technical|\bit\b|legal|eviction|attorney|account|audit|bank|credit card|processing fee|application processing|screening|credit (check|report)|tenant eval|postage|office|dues|subscription|license|permit|travel|mileage|meal|food|lodging|entertain|education|training|seminar|professional|answering|courier|printing|copier|forms|equipment rental|admin|g and a|general and admin|music|meeting|recognition|revenue management|market stud|placement|inspection|parking|rent expense|org exp', 'admin'),
    (r'.', 'rm'),
]

def classify(text, side, section=''):
    t = norm(text); sec = norm(section)
    if re.search(EXCLUDE, t):
        return ''
    if side == 'inc':
        for pat, code in INC_RULES:
            if re.search(pat, t): return code
        return ''
    for pat, code in EXP_STRONG:
        if re.search(pat, t): return code
    for pat, code in SEC_EXP:
        if re.search(pat, sec): return code
    for pat, code in EXP_WEAK:
        if re.search(pat, t): return code
    return 'rm'

# ---- House rules (Chase, Oct 2026), applied after Appendix A / rules ----
BULK_INC = r'cable|internet|satellite|wifi|wi fi|broadband|bulk service|smart ?home'
def apply_house_rules(text, side, code):
    t = norm(text)
    if code == '':
        return code
    if code in ('park', 'comm', 'CAM'):
        return 'oinc'                                   # parking/garage/commercial -> Other Residential Income
    if code == 'door':
        return 'pers'
    if code == 'oexp':
        return 'admin'
    if side == 'inc' and re.search(r'laundry', t):
        return 'oinc'
    if side == 'inc' and re.search(r'employee|teammate|model|courtesy officer|staff unit|office unit|admin unit', t) \
            and code in ('conc', 'vac', 'nr'):
        return 'nr'
    if side == 'inc' and re.search(BULK_INC, t):
        return 'smart'
    return code

def load_exceptions(text):
    """Parse Appendix A lines 'side|code|normalized text' into {(text, side): code}."""
    out = {}
    for ln in text.strip().splitlines():
        s, c, n = ln.split('|', 2); out[(n.strip(), s.strip())] = '' if c.strip() == '-' else c.strip()
    return out

def code_line(text, side, section, exceptions, corrections=None):
    key = (norm(text), side)
    if corrections and key in corrections: return corrections[key], 'correction'
    if key in exceptions: return exceptions[key], 'exception'
    return apply_house_rules(text, side, classify(text, side, section)), 'rule'
