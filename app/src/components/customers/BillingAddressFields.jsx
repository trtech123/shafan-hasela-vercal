import { useId } from 'react';
import { Input } from '@/components/ui/input';

const fields = [['billing_address_line', 'כתובת לחיוב'], ['billing_city', 'עיר'], ['billing_postal_code', 'מיקוד'], ['billing_country_code', 'קוד מדינה']];

export default function BillingAddressFields({ value, onChange }) {
  const id = useId();
  return <fieldset className="space-y-2">
    <legend className="text-sm font-medium">כתובת לחיוב (לא חובה)</legend>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {fields.map(([field, label]) => <div key={field} className="space-y-1">
        <label className="text-sm" htmlFor={`${id}-${field}`}>{label}</label>
        <Input id={`${id}-${field}`} value={value[field] || ''} onChange={(event) => onChange(field, event.target.value)} />
      </div>)}
    </div>
  </fieldset>;
}
