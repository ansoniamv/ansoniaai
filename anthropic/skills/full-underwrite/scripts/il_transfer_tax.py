"""Illinois real estate transfer tax -> S&U D8 (a rate; S&U E8 = D8 x purchase price).
S&U is the buyer's Uses, so D8 = the BUYER-paid share by local custom. State ($0.50/$500) and county
($0.25/$500) are customarily seller-paid; Chicago's CTA portion ($1.50/$500) is seller-paid; Chicago's city
portion ($3.75/$500) is buyer-paid. Municipal rates per the 2026 title-industry lists (verify each deal on the
web / ATG ordinance list: atgf.com/tax-ordinance/all; unknown municipality -> search before defaulting to 0)."""
STATE, COUNTY, CHI_CITY, CHI_CTA = 0.50 / 500, 0.25 / 500, 3.75 / 500, 1.50 / 500
# municipality: (rate per $1,000, payer)  -- as of Aug/Sep 2026
MUNI = {
    'berwyn': (10.00, 'seller'), 'cicero': (10.00, 'seller'), 'oak park': (8.00, 'seller'), 'oak lawn': (5.00, 'seller'),
    'evergreen park': (5.00, 'seller'), 'evanston': (5.00, 'seller'), 'highland park': (5.00, 'seller'),
    'aurora': (3.00, 'seller'), 'joliet': (3.00, 'seller'), 'skokie': (3.00, 'seller'), 'des plaines': (2.00, 'seller'),
    'park ridge': (2.00, 'seller'), 'elmhurst': (1.50, 'seller'), 'schaumburg': (1.00, 'seller'),
    'naperville': (3.00, 'buyer'), 'mount prospect': (3.00, 'buyer'), 'wilmette': (3.00, 'buyer'),
    'wheaton': (2.50, 'buyer'), 'romeoville': (3.50, 'buyer'), 'bolingbrook': (3.75, 'split'), 'calumet city': (4.00, 'split'),
}
NONE = {'arlington heights', 'orland park', 'palatine', 'elgin', 'waukegan', 'brookfield', 'villa park', 'westchester',
        'tinley park', 'new lenox', 'mokena', 'frankfort'}

def buyer_rate(city, price=None):
    """Returns (D8 formula, note, known). Evanston tiers above $1.5M ($7 / $9 per $1,000) are seller-paid, so ignored."""
    c = (city or '').strip().lower()
    total_seller = f'state $0.50/$500 + county $0.25/$500 seller-paid'
    if c == 'chicago':
        return '=3.75/500', f'Chicago city portion $3.75/$500 (0.75%) buyer-paid; CTA $1.50/$500 + {total_seller} excluded', True
    if c in MUNI:
        r, payer = MUNI[c]
        if payer == 'buyer': return f'={r}/1000', f'{city} municipal ${r:.2f}/$1,000 buyer-paid; {total_seller}', True
        if payer == 'split': return f'={r}/1000/2', f'{city} municipal ${r:.2f}/$1,000 split 50/50 (buyer half); {total_seller}', True
        return '=0', f'{city} municipal ${r:.2f}/$1,000 seller-paid; {total_seller} - no buyer-paid transfer tax', True
    if c in NONE:
        return '=0', f'{city}: no municipal transfer tax; {total_seller} - no buyer-paid transfer tax', True
    return None, f'{city}: municipality not in the table - look it up (ATG ordinance list) before setting D8', False
